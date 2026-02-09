"""
React API calls - submits to Redis queue
"""
import redis
import json
import uuid
import os
import time
from datetime import datetime
from dotenv import load_dotenv
import logging
import mysql.connector

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class HistomicsMLBridge:
    """Bridge between Flask API and HistomicsML's run_model_server.py"""
    
    def __init__(self):
        """Initialize Redis and MySQL connections"""
        try:
            # Redis connection
            self.redis = redis.StrictRedis(
                host=os.getenv('REDIS_HOST', 'localhost'),
                port=int(os.getenv('REDIS_PORT', 6379)),
                db=int(os.getenv('REDIS_DB', 0)),
                decode_responses=True
            )
            
            # Also create redis_client alias for compatibility
            self.redis_client = self.redis
            
            # Queue name must match HistomicsML settings.py
            self.request_queue = 'REQUEST_QUEUE'
            self.REQUEST_QUEUE = self.request_queue  # Alias for compatibility
            
            # Generate unique user ID
            self.user_id = 'user_' + str(uuid.uuid4())[:8]
            
            # Test Redis connection
            self.redis.ping()
            logger.info("Redis connection successful")
            
            # Database configuration for mysql.connector
            self.db_config = {
                'host': os.getenv('DB_HOST', 'localhost'),
                'user': os.getenv('DB_USER', 'root'),
                'password': os.getenv('DB_PASSWORD', ''),
                'database': os.getenv('DB_NAME', 'new_histomics'),
                'port': int(os.getenv('DB_PORT', 3306)),
                'charset': 'utf8',
                'use_unicode': True
            }
            
            # Test MySQL connection
            try:
                test_conn = mysql.connector.connect(**self.db_config)
                test_conn.close()
                logger.info(f"MySQL connection successful - DB: {self.db_config['database']}")
            except mysql.connector.Error as e:
                logger.error(f"MySQL connection failed: {e}")
                raise
            
        except redis.RedisError as e:
            logger.error(f"Redis connection failed: {e}")
            raise
    
    def submit_training_job(self, dataset_id, slide_id, slide_name, annotations, target='train_heatmap'):
        """
        Submit training job to Redis queue
        
        Args:
            dataset_id: Database ID of dataset
            slide_id: Database ID of slide
            slide_name: Name of slide (e.g., 'TCGA-02..........tif')
            annotations: List of {nucleus_id, label}
            target: Target handler in model_server (default: 'train_heatmap')
        """
        try:
            # Get dataset info from database using db_config
            conn = mysql.connector.connect(**self.db_config)
            cursor = conn.cursor(dictionary=True)
            
            cursor.execute("""
                SELECT features_file, pca_file 
                FROM datasets 
                WHERE id = %s
            """, (dataset_id,))
            
            dataset = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not dataset:
                raise Exception(f"Dataset {dataset_id} not found")
            
            # Generate job ID
            job_id = str(uuid.uuid4())
            
            # Create job data for Redis queue
            job_data = {
                'id': job_id,
                'uid': self.user_id,
                'target': target,
                'dataset': dataset['features_file'],
                'pca': dataset['pca_file'],
                'slide_name': slide_name,
                'samples': annotations,
                'timestamp': time.time()
            }
            
            # Push to Redis queue
            self.redis.lpush(self.request_queue, json.dumps(job_data))
            
            logger.info(f"[BRIDGE] Submitted job {job_id} with target={target}")
            logger.info(f"[BRIDGE] Slide: {slide_name}, Samples: {len(annotations)}")
            
            return job_id
            
        except Exception as e:
            logger.error(f"[BRIDGE ERROR] {str(e)}")
            raise
    
    def submit_prediction_job(self, dataset_id, slide_id, slide_name, model_name=None):
        """
        Submit prediction job using existing model (no training)

        Args:
            dataset_id: Database ID of dataset
            slide_id: Database ID of slide
            slide_name: Name of slide
        """
        try:
            # Get dataset info
            conn = mysql.connector.connect(**self.db_config)
            cursor = conn.cursor(dictionary=True)

            cursor.execute("""
                SELECT features_file, pca_file
                FROM datasets
                WHERE id = %s
            """, (dataset_id,))

            dataset = cursor.fetchone()
            cursor.close()
            conn.close()

            if not dataset:
                raise Exception(f"Dataset {dataset_id} not found")

            # Generate job ID
            job_id = str(uuid.uuid4())
        
            # Use provided model_name or default to slide_name
            model_to_use = model_name if model_name else slide_name

            # Create job data for Redis queue
            job_data = {
                'id': job_id,
                'uid': self.user_id,
                'target': 'predict_only',
                'dataset': dataset['features_file'],
                'pca': dataset['pca_file'],
                'slide_name': slide_name,      # Slide to predict on
                'model_name': model_to_use,    # Model to use
                'timestamp': time.time()
            }

            # Push to Redis queue
            self.redis.lpush(self.request_queue, json.dumps(job_data))

            logger.info(f"[BRIDGE] Submitted predict_only job {job_id}")
            logger.info(f"[BRIDGE] Model: {model_to_use}, Slide: {slide_name}")

            return job_id

        except Exception as e:
            logger.error(f"[BRIDGE ERROR] {str(e)}")
            raise


    def get_job_status(self, job_id):
        """
        Get job status from Redis
        
        HistomicsML stores results with job_id as key when complete
        
        Returns:
            {
                'status': 'queued' | 'processing' | 'completed' | 'failed',
                'progress': 0-100,
                'message': 'Status message',
                'result': {...} if completed
            }
        """
        try:
            # Check if result exists in Redis (means job completed)
            result = self.redis.get(job_id)
            
            if result:
                # Job completed - HistomicsML stored result
                result_data = json.loads(result)
                
                return {
                    'status': 'completed',
                    'progress': 100,
                    'message': 'Training and prediction completed',
                    'result_available': True,
                    'result': result_data
                }
            else:
                # Job still in queue or processing
                queue_length = self.redis.llen(self.request_queue)
                
                return {
                    'status': 'processing',
                    'progress': 50,
                    'message': f'Job processing (queue length: {queue_length})',
                    'result_available': False
                }
                
        except Exception as e:
            logger.error(f"Error getting job status: {e}")
            return {
                'status': 'error',
                'progress': 0,
                'message': str(e),
                'result_available': False
            }
    
    
    def get_predictions(self, job_id):
        """
        Get predictions from completed job
        
        Returns:
            List of predictions with format:
            [
                {
                    'nucleus_id': 123,
                    'x': 1234.5,
                    'y': 5678.9,
                    'prediction': 'positive',
                    'probability': 0.95
                },
                ...
            ]
        """
        try:
            # Get result from Redis
            result = self.redis.get(job_id)
            
            if not result:
                logger.warning(f"No predictions found for job {job_id}")
                return None
            
            result_data = json.loads(result)
            
            # Parse HistomicsML's result format
            predictions = self._parse_histomics_predictions(result_data)
            
            logger.info(f"Retrieved {len(predictions)} predictions for job {job_id}")
            
            return predictions
            
        except Exception as e:
            logger.error(f"Error getting predictions: {e}")
            raise
    
    
    def _parse_histomics_predictions(self, result_data):
        """
        Parse HistomicsML's result format into our format
        """
        predictions = []
        
        if 'predictions' in result_data:
            raw_predictions = result_data['predictions']
        elif 'results' in result_data:
            raw_predictions = result_data['results']
        elif isinstance(result_data, list):
            raw_predictions = result_data
        else:
            logger.warning(f"Unknown result format: {result_data.keys()}")
            raw_predictions = []
        
        # Convert to our format
        for pred in raw_predictions:
            predictions.append({
                'nucleus_id': pred.get('nucleus_id') or pred.get('id'),
                'x': pred.get('x') or pred.get('centroid_x'),
                'y': pred.get('y') or pred.get('centroid_y'),
                'prediction': 'positive' if pred.get('class') == 1 or pred.get('label') == 'positive' else 'negative',
                'probability': pred.get('probability') or pred.get('score') or 0.5
            })
        
        return predictions
    
    
    def test_connection(self):
        """Test Redis and MySQL connections"""
        try:
            self.redis.ping()
            queue_length = self.redis.llen(self.request_queue)
            
            # Test MySQL
            conn = mysql.connector.connect(**self.db_config)
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            conn.close()
            
            return True, f"Connected. Queue length: {queue_length}"
        except Exception as e:
            return False, str(e)


# Test the bridge when run directly
if __name__ == '__main__':
    print("Testing HistomicsML Bridge...")
    
    try:
        bridge = HistomicsMLBridge()
        success, message = bridge.test_connection()
        
        if success:
            print(f"Success: {message}")
        else:
            print(f"Connection failed: {message}")
            
    except Exception as e:
        print(f"Error: {e}")
