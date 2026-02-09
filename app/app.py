from histomics_integration import HistomicsMLBridge
from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime
import mysql.connector
import os
from dotenv import load_dotenv
import logging
import redis
import uuid
import json
import time
import pickle

# Get directory where app.py is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Navigate to config directory (one level up, then into config/)
PROJECT_ROOT = os.path.dirname(BASE_DIR)
ENV_PATH = os.path.join(PROJECT_ROOT, 'config', '.env.prod')


# Load environment variables
if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH)
    print(f"Loaded config from: {ENV_PATH}")
else:
    load_dotenv()

app = Flask(__name__)
try:
    histomics_integration = HistomicsMLBridge()
    print(" HistomicsML Bridge initialized")
except Exception as e:
    print(f" HistomicsML Bridge initialization failed: {e}")
    histomics_integration = None

# Enable CORS for same domain
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_MODEL_FILE_SIZE = 100 * 1024 * 1024  # 100MB

# Initialize Redis
db = redis.StrictRedis(
    host=os.getenv('REDIS_HOST', 'localhost'),
    port=int(os.getenv('REDIS_PORT', 6379)),
    db=int(os.getenv('REDIS_DB', 0)),
    password=os.getenv('REDIS_PASSWORD', None) 
)

# Database configuration
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD'),
    'database': os.getenv('DB_NAME'),
    'port': int(os.getenv('DB_PORT', 3306))
}

def get_db_connection():
    """Create database connection with error handling"""
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        return connection
    except mysql.connector.Error as err:
        logger.error(f"Database connection error: {err}")
        return None

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'message': 'Histomics API on Port 5000'})

@app.route('/api/datasets', methods=['GET'])
def get_datasets():
    """Get list of all datasets"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
        SELECT 
            d.id,
            d.name,
            d.features_file,
            d.pca_file,
            d.superpixel_size,
            COUNT(ds.slide_id) as slide_count
        FROM datasets d
        LEFT JOIN dataset_slides ds ON d.id = ds.dataset_id
        GROUP BY d.id, d.name, d.features_file, d.pca_file, d.superpixel_size
        ORDER BY d.name
        """
        cursor.execute(query)
        datasets = cursor.fetchall()
        
        return jsonify({
            'success': True,
            'datasets': datasets,
            'count': len(datasets)
        })
        
    except mysql.connector.Error as err:
        logger.error(f"Database query error: {err}")
        return jsonify({'error': 'Failed to fetch datasets'}), 500
        
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()

@app.route('/api/datasets/<int:dataset_id>/slides', methods=['GET'])
def get_slides_by_dataset(dataset_id):
    """Get list of slides for a specific dataset"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
        SELECT 
            s.id,
            s.name,
            s.patient,
            s.x_size,
            s.y_size,
            s.pyramid_path,
            s.scale
        FROM slides s
        INNER JOIN dataset_slides ds ON s.id = ds.slide_id
        WHERE ds.dataset_id = %s
        ORDER BY s.name
        """
        cursor.execute(query, (dataset_id,))
        slides = cursor.fetchall()
        
        # Get dataset info
        cursor.execute("SELECT name FROM datasets WHERE id = %s", (dataset_id,))
        dataset_info = cursor.fetchone()
        
        return jsonify({
            'success': True,
            'slides': slides,
            'dataset_id': dataset_id,
            'dataset_name': dataset_info['name'] if dataset_info else 'Unknown',
            'count': len(slides)
        })
        
    except mysql.connector.Error as err:
        logger.error(f"Database query error: {err}")
        return jsonify({'error': 'Failed to fetch slides'}), 500
        
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()

@app.route('/api/slides/<int:slide_id>', methods=['GET'])
def get_slide_details(slide_id):
    """Get detailed information about a specific slide"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = connection.cursor(dictionary=True)
        query = """
        SELECT 
            s.*,
            d.name as dataset_name,
            d.id as dataset_id
        FROM slides s
        LEFT JOIN dataset_slides ds ON s.id = ds.slide_id
        LEFT JOIN datasets d ON ds.dataset_id = d.id
        WHERE s.id = %s
        """
        cursor.execute(query, (slide_id,))
        slide = cursor.fetchone()
        
        if slide:
            return jsonify({
                'success': True,
                'slide': slide
            })
        else:
            return jsonify({'error': 'Slide not found'}), 404
            
    except mysql.connector.Error as err:
        logger.error(f"Database query error: {err}")
        return jsonify({'error': 'Failed to fetch slide details'}), 500
        
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()

# Nuclei boundary endpoint
@app.route('/api/nuclei/<slide_name>', methods=['GET'])
def get_nuclei_boundaries(slide_name):
    """Fetch precomputed nuclei boundaries for a slide"""
    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500
    
    try:
        cursor = connection.cursor(dictionary=True)
        
        # Fetch nuclei from database
        query = """
        SELECT nucleus_id, x, y, bbox_x0, bbox_y0, bbox_x1, bbox_y1
        FROM nuclei_boundary
        WHERE slide = %s
        """
        cursor.execute(query, (slide_name,))
        nuclei = cursor.fetchall()
        
        logger.info(f"Fetched {len(nuclei)} nuclei for slide {slide_name}")
        
        return jsonify({
            'success': True,
            'nuclei': nuclei,
            'nucleus_count': len(nuclei)
        })
        
    except mysql.connector.Error as err:
        logger.error(f"Database query error: {err}")
        return jsonify({'error': f'Failed to fetch nuclei: {str(err)}'}), 500
        
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()


@app.route("/api/segmentation/status")
def segmentation_status():
    """Check segmentation queue status"""
    try:
        queue_length = db.llen(s.REQUEST_QUEUE)
        return jsonify({
            "success": True,
            "queue_length": queue_length,
            "redis_connected": True
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/samples/annotate', methods=['POST'])
def annotate_samples():
    """
    Save user-selected sample annotations
    
    Expected JSON:
    {
        "slide_id": 1,
        "annotations": [
            {"nucleus_id": 123, "label": "positive"},
            {"nucleus_id": 456, "label": "negative"},
            ... 8 samples total (4 positive, 4 negative)
        ]
    }
    """
    try:
        data = request.get_json()
        slide_id = data.get('slide_id')
        annotations = data.get('annotations', [])

        if not slide_id or not annotations:
            return jsonify({
                'success': False,
                'error': 'slide_id and annotations required'
            }), 400
        
        # Validate we have exactly 8 samples (4 positive, 4 negative)
        positive_count = sum(1 for a in annotations if a['label'] == 'positive')
        negative_count = sum(1 for a in annotations if a['label'] == 'negative')
        
        if len(annotations) != 8:
            return jsonify({
                'success': False,
                'error': f'Must select exactly 8 samples, got {len(annotations)}'
            }), 400
        
        if positive_count != 4 or negative_count != 4:
            return jsonify({
                'success': False,
                'error': f'Must select 4 positive and 4 negative samples. Got {positive_count} positive, {negative_count} negative'
            }), 400
        
        
        logger.info(f'Validated {len(annotations)} annotations for slide {slide_id}')
        
        return jsonify({
            'success': True,
            'message': f'Validated {len(annotations)} annotations'
        })
        
    except Exception as e:
        logger.error(f'Error saving annotations: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/ml/train-histomics', methods=['POST'])
def train_with_histomics():
    """
    Submit training job to HistomicsML
    
    Expected JSON:
    {
        "dataset_id": 1,
        "slide_id": 1,
        "annotations": [
            {"nucleus_id": 1, "label": "positive"},
            {"nucleus_id": 2, "label": "positive"},
            {"nucleus_id": 3, "label": "positive"},
            {"nucleus_id": 4, "label": "positive"},
            {"nucleus_id": 5, "label": "negative"},
            {"nucleus_id": 6, "label": "negative"},
            {"nucleus_id": 7, "label": "negative"},
            {"nucleus_id": 8, "label": "negative"}
        ]
    }
    """
    try:
        if not histomics_integration:
            return jsonify({
                'success': False,
                'error': 'HistomicsML bridge not initialized'
            }), 500
        
        data = request.get_json()
        dataset_id = data.get('dataset_id')
        slide_id = data.get('slide_id')
        annotations = data.get('annotations', [])
        
        # Validate inputs
        if not dataset_id or not slide_id:
            return jsonify({
                'success': False,
                'error': 'dataset_id and slide_id required'
            }), 400
        
        if len(annotations) % 8 != 0 or len(annotations) < 8:
            return jsonify({
                 'success': False,
                 'error': f'Must provide multiple of 8 annotations (got {len(annotations)})'
            }), 400

        # Log iteration information
        iteration_num = len(annotations) // 8
        logger.info(f'Training iteration {iteration_num} with {len(annotations)} total annotations') 
        
        # Get slide name from database (needed for HDF5 lookup)
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT name FROM slides WHERE id = %s", (slide_id,))
        slide = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not slide:
            return jsonify({
                'success': False,
                'error': f'Slide {slide_id} not found'
            }), 404
        
        slide_name = slide['name']
        
        # Submit to HistomicsML via bridge
        job_id = histomics_integration.submit_training_job(
            dataset_id=dataset_id,
            slide_id=slide_id,
            slide_name=slide_name,
            annotations=annotations,
            target='train_heatmap'
        )
        
        logger.info(f'Submitted train_heatmap job: {job_id}')
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'message': 'Training job submitted to HistomicsML'
        })
        
    except Exception as e:
        logger.error(f'Error submitting to HistomicsML: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/ml/status-histomics/<job_id>', methods=['GET'])
def get_histomics_status(job_id):
    """
    Get job status from HistomicsML
    
    Returns:
    {
        "success": true,
        "job_id": "abc-123",
        "status": "completed",
        "progress": 100,
        "message": "Training completed"
    }
    """
    try:
        if not histomics_integration:
            return jsonify({
                'success': False,
                'error': 'HistomicsML bridge not initialized'
            }), 500
        
        status = histomics_integration.get_job_status(job_id)
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            **status
        })
        
    except Exception as e:
        logger.error(f'Error getting status: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/predictions-histomics/<job_id>', methods=['GET'])
def get_histomics_predictions(job_id):
    try:
        import redis
        import json
        
        # Connect to Redis directly
        db = redis.StrictRedis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', 6379)),
            db=int(os.getenv('REDIS_DB', 0))
        )
        
        # Get result directly from Redis
        result = db.get(job_id)
        
        if not result:
            logger.warning(f"No predictions found for job {job_id}")
            return jsonify({'success': False, 'error': 'Predictions not ready or not found'}), 404
        
        # Parse the result
        result_data = json.loads(result.decode('utf-8'))
        
        # Return as-is since model_server already formatted it correctly
        return jsonify(result_data)
        
    except Exception as e:
        logger.error(f'Error getting predictions: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

MODEL_SERVER_CHECKPOINT_DIR = '/opt/histomics-prod/ml/checkpoints'

@app.route('/api/ml/models/list', methods=['GET'])
def list_available_models():
    """List all available trained models on server"""
    try:
        if not os.path.exists(MODEL_SERVER_CHECKPOINT_DIR):
            return jsonify({'success': True, 'models': []})

        models = []
        for filename in os.listdir(MODEL_SERVER_CHECKPOINT_DIR):
            if filename.endswith('.pkl'):
                filepath = os.path.join(MODEL_SERVER_CHECKPOINT_DIR, filename)
                stat = os.stat(filepath)

                # Verify it's a valid model
                try:
                    import joblib
                    joblib.load(filepath)
                    is_valid = True
                except:
                    is_valid = False

                models.append({
                    'slide_name': filename.replace('.pkl', ''),
                    'filename': filename,
                    'size_mb': round(stat.st_size / (1024 * 1024), 2),
                    'created': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                    'is_valid': is_valid
                })

        models.sort(key=lambda x: x['created'], reverse=True)

        return jsonify({
            'success': True,
            'models': models,
            'count': len(models)
        })

    except Exception as e:
        logger.error(f"Error listing models: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/ml/predict-with-model', methods=['POST'])
def predict_with_existing_model():
    """
    Run predictions using an existing uploaded model
    No training - just load model and predict

    Expected JSON:
    {
        "dataset_id": 1,
        "slide_id": 1
    }
    """
    try:
        if not histomics_integration:
            return jsonify({
                'success': False,
                'error': 'HistomicsML bridge not initialized'
            }), 500

        data = request.get_json()
        dataset_id = data.get('dataset_id')
        slide_id = data.get('slide_id')
        model_name = data.get('model_name')  # ← NEW: Model to use

        if not dataset_id or not slide_id or not model_name:
            return jsonify({
                'success': False,
                'error': 'dataset_id, slide_id, and model_name required'
            }), 400

        # Get current slide name (slide we're predicting on)
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT name FROM slides WHERE id = %s", (slide_id,))
        slide = cursor.fetchone()
        cursor.close()
        conn.close()

        if not slide:
            return jsonify({
                'success': False,
                'error': f'Slide {slide_id} not found'
            }), 404

        slide_name = slide['name']

        # Check if selected model exists
        model_path = os.path.join(MODEL_SERVER_CHECKPOINT_DIR, f'{model_name}.pkl')
        if not os.path.exists(model_path):
            return jsonify({
                'success': False,
                'error': f'Model not found: {model_name}.pkl'
            }), 404

        # Detect transfer learning
        transfer_learning = (model_name != slide_name)
        
        if transfer_learning:
            logger.info(f'Transfer Learning: Using model {model_name} on slide {slide_name}')
        else:
            logger.info(f'Direct prediction: Using model {model_name} on training slide')

        # Submit prediction job
        job_id = histomics_integration.submit_prediction_job(
            dataset_id=dataset_id,
            slide_id=slide_id,
            slide_name=slide_name,
            model_name=model_name  # ← Pass the selected model
        )

        logger.info(f'Submitted predict_only job: {job_id}')

        return jsonify({
            'success': True,
            'job_id': job_id,
            'transfer_learning': transfer_learning,
            'message': f'Prediction job submitted using model {model_name}'
        })

    except Exception as e:
        logger.error(f'Error submitting prediction job: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/ml/models', methods=['GET'])
def list_models():
    """List all saved models in checkpoint directory"""
    try:
        if not os.path.exists(MODEL_SERVER_CHECKPOINT_DIR):
            return jsonify({
                'success': False, 
                'error': 'Checkpoint directory not found'
            })
        
        models = []
        for filename in os.listdir(MODEL_SERVER_CHECKPOINT_DIR):
            if filename.endswith('.pkl'):
                filepath = os.path.join(MODEL_SERVER_CHECKPOINT_DIR, filename)
                stat = os.stat(filepath)
                
                models.append({
                    'name': filename,
                    'slide_name': filename.replace('.pkl', ''),
                    'size_bytes': stat.st_size,
                    'size_kb': round(stat.st_size / 1024, 2),
                    'size_mb': round(stat.st_size / (1024 * 1024), 2),
                    'modified': stat.st_mtime,
                    'modified_date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                    'path': filepath
                })
        
        # Sort by modification time (newest first)
        models.sort(key=lambda x: x['modified'], reverse=True)
        
        logger.info(f"Found {len(models)} models in checkpoint directory")
        
        return jsonify({
            'success': True,
            'models': models,
            'count': len(models),
            'checkpoint_dir': MODEL_SERVER_CHECKPOINT_DIR
        })
        
    except Exception as e:
        logger.error(f"Error listing models: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting Histomics API on localhost:5000")
    app.run(debug=False, host='127.0.0.1', port=5000)
