"""
ML Worker - Trains Random Forest models and generates predictions via Redis queue.
"""
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '1'
import json
import numpy as np
import redis
from time import time
import joblib

import settings
import networks
import dataset

CHECKPOINT_DIR = os.environ.get('CHECKPOINT_DIR', './checkpoints')

def convert_numpy_types(obj):
    """Convert NumPy data types to native Python types for JSON serialization"""
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(i) for i in obj]
    elif isinstance(obj, np.bytes_):
        return obj.decode("utf-8")
    elif isinstance(obj, bytes):
        return obj.decode("utf-8")
    elif isinstance(obj, np.generic):
        return obj.item()
    else:
        return obj


def run():
    # Initialize settings
    set = settings.Settings()

    try:
        # Connect to Redis server
        db = redis.StrictRedis(host=set.REDIS_HOST,
                               port=set.REDIS_PORT, db=set.REDIS_DB)
        print(db)
        print(db.ping())
        print('Connected to Redis!')
    except Exception as ex:
        print('Error:', ex)
        exit('Failed to connect to Redis, terminating.')

    # Initialize neural network model
    model = networks.Network()
    model.init_model()
    print("Model initialized.")

    # Dataset will be loaded per request
    dset = None
    current_dataset_path = None
    tset_name = None

    print("Server ready. Waiting for requests...")

    while True:
        queue = db.lrange(set.REQUEST_QUEUE, set.REQUEST_START, set.REQUEST_END)
        q_uid = None

        for q in queue:
            q = json.loads(q.decode("utf-8"))
            q_uid = q["uid"]
            q_id = q.get("id", q_uid)
            target = q["target"]
            dataSetPath = set.DATASET_DIR + q["dataset"]

            # Load dataset if not already loaded or if different dataset
            if dset is None or current_dataset_path != dataSetPath:
                print(f"Loading dataset: {dataSetPath}")
                dset = dataset.Dataset(dataSetPath)
                current_dataset_path = dataSetPath
                print("Dataset loaded successfully.")

        if q_uid is not None:
            print(f"\n[{target}] Session Start .....")

            if target == 'train_heatmap':
                """
                Train with user samples using array indices
                """
                print("[TRAIN_HEATMAP] Starting training and prediction...")

                # Get training samples from request
                training_samples = q.get('samples', [])
                slide_name = q.get('slide_name', '')

                if not training_samples:
                    print("[ERROR] No training samples provided")
                    data = {'success': False, 'error': 'No training samples'}
                    db.set(q_uid, json.dumps(data))
                    db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                    continue

                print(f"[INFO] Training with {len(training_samples)} samples on slide: {slide_name}")

                # Get slide information
                slide_idx = dset.getSlideIdx(slide_name)
                object_num = dset.getObjNum(slide_idx)
                data_idx = dset.getDataIdx(slide_idx)

                print(f"[INFO] Slide '{slide_name}' -> slide_idx={slide_idx}, data_idx={data_idx}, objects={object_num}")

                # Extract features and labels for training using array indices
                train_features = []
                train_labels = []

                for sample in training_samples:
                    # Get the index within this slide
                    local_index = sample.get('index')
                    label = 1 if sample['label'] == 'positive' else 0

                    if local_index is None:
                        print(f"[ERROR] Sample missing 'index' field: {sample}")
                        continue

                    # Calculate absolute index in HDF5 file
                    absolute_index = data_idx + local_index

                    # Verify index is in bounds
                    if absolute_index >= len(dset.features):
                        print(f"[ERROR] Absolute index {absolute_index} out of bounds (max: {len(dset.features)-1})")
                        print(f"        data_idx={data_idx}, local_index={local_index}")
                        continue

                    # Get 64-dimensional feature vector
                    feature = dset.features[absolute_index]

                    train_features.append(feature)
                    train_labels.append(label)

                    print(f"[DEBUG] Sample {len(train_features)}: local_idx={local_index}, abs_idx={absolute_index}, label={'positive' if label==1 else 'negative'}")

                if len(train_features) < 2:
                    print(f"[ERROR] Only found {len(train_features)} valid samples (need at least 2)")
                    data = {'success': False, 'error': f'Only {len(train_features)} valid samples found'}
                    db.set(q_uid, json.dumps(data))
                    db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                    continue

                train_features = np.array(train_features)
                train_labels = np.array(train_labels)

                print(f"[INFO] Successfully extracted {len(train_features)} training samples")
                print(f"[INFO] Training features shape: {train_features.shape}")
                print(f"[INFO] Training labels: {train_labels}")

                # Set classifier name
                if tset_name is None:
                    tset_name = q.get('slide_name', 'model').replace('.', '_')

                print(f"[INFO] Using classifier name: {tset_name}")

                # Train Random Forest model
                print("[INFO] Training Random Forest...")
                t0 = time()
                model.train_model(train_features, train_labels, tset_name)
                t1 = time()
                print(f"[INFO] Training took {t1 - t0:.2f} seconds")

                # Verify model was saved
                if not model.classifier:
                    print("[ERROR] Classifier name not set after training!")
                    data = {'success': False, 'error': 'Training failed - no classifier name'}
                    db.set(q_uid, json.dumps(data))
                    db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                    continue

                checkpoint_path = f"./checkpoints/{model.classifier}.pkl"

                if not os.path.exists(checkpoint_path):
                    print(f"[ERROR] Model checkpoint not found: {checkpoint_path}")
                    data = {'success': False, 'error': f'Model file not saved: {checkpoint_path}'}
                    db.set(q_uid, json.dumps(data))
                    db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                    continue

                print(f"[SUCCESS] Model saved and verified: {checkpoint_path}")

                # Get ALL features and centroids for the slide
                print(f"[INFO] Getting features for {object_num} nuclei...")
                test_features = dset.getFeatureSet(data_idx, object_num)
                x_centroid_set = dset.getXcentroidSet(data_idx, object_num)
                y_centroid_set = dset.getYcentroidSet(data_idx, object_num)

                # Handle NaN values
                if np.isnan(test_features).any():
                    print("[WARNING] Found NaN values in features, cleaning...")
                    test_features = np.nan_to_num(test_features, nan=0.0)

                # Predict ALL nuclei
                print("[INFO] Predicting all nuclei...")
                t0 = time()
                predictions = model.predict(test_features)
                probabilities = model.predict_prob(test_features)
                t1 = time()
                print(f"[INFO] Prediction took {t1 - t0:.2f} seconds")

                # Count results
                positive_count = int((predictions > 0).sum())
                negative_count = int((predictions == 0).sum())

                print(f"[SUCCESS] Generated {len(predictions)} predictions")
                print(f"[INFO] Positive: {positive_count}, Negative: {negative_count}")

                # Format results for React
                data = {
                    'success': True,
                    'slide_name': slide_name,
                    'total_count': len(predictions),
                    'positive_count': positive_count,
                    'negative_count': negative_count,
                    'predictions': []
                }

                # Store predictions with centroids
                for i in range(len(predictions)):
                    pred_obj = {
                        'index': i,
                        'x': float(x_centroid_set[i][0]),
                        'y': float(y_centroid_set[i][0]),
                        'prediction': 'positive' if predictions[i] > 0 else 'negative',
                        'probability': float(probabilities[i])
                    }
                    data['predictions'].append(pred_obj)

                # Store in Redis
                db.set(q_id, json.dumps(data))
                print(f"[SUCCESS] Results stored in Redis with key: {q_id}")

                db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                print("[TRAIN_HEATMAP] Complete!\n")

            elif target == 'predict_only': 
                    """
                    Run predictions using existing trained model (no training)
                    """
                    print("[PREDICT_ONLY] Starting prediction with existing model...")

                    slide_name = q.get('slide_name', '')          # Slide to predict on
                    model_name = q.get('model_name', slide_name)  #  Model to use 

                    if not slide_name:
                        print("[ERROR] No slide_name provided")
                        data = {'success': False, 'error': 'No slide_name provided'}
                        db.set(q_uid, json.dumps(data))
                        db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                        continue

                    # Check if model exists (use model_name instead of slide_name)
                    checkpoint_path = f"./checkpoints/{model_name}.pkl"
                    if not os.path.exists(checkpoint_path):
                        print(f"[ERROR] No model found: {checkpoint_path}")
                        data = {'success': False, 'error': f'No trained model found for {model_name}'}
                        db.set(q_uid, json.dumps(data))
                        db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                        continue

                    # Log transfer learning 
                    if model_name != slide_name:
                        print(f"[TRANSFER LEARNING] Using model '{model_name}' on slide '{slide_name}'")
                    else:
                        print(f"[PREDICT_ONLY] Using model '{model_name}' on training slide")
                    print(f"[PREDICT_ONLY] Loading model from: {checkpoint_path}")

                    # Load the existing model
                    try:
                        import pickle
                        loaded_model = joblib.load(checkpoint_path)
                        print(f"[PREDICT_ONLY] Model loaded successfully")
                    except Exception as e:
                        print(f"[ERROR] Failed to load model: {e}")
                        data = {'success': False, 'error': f'Failed to load model: {str(e)}'}
                        db.set(q_uid, json.dumps(data))
                        db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                        continue

                    # Get slide information
                    slide_idx = dset.getSlideIdx(slide_name)
                    object_num = dset.getObjNum(slide_idx)
                    data_idx = dset.getDataIdx(slide_idx)
    
                    print(f"[PREDICT_ONLY] Slide '{slide_name}' -> slide_idx={slide_idx}, objects={object_num}")
    
                    # Get ALL features and centroids for the slide
                    print(f"[PREDICT_ONLY] Getting features for {object_num} nuclei...")
                    test_features = dset.getFeatureSet(data_idx, object_num)
                    x_centroid_set = dset.getXcentroidSet(data_idx, object_num)
                    y_centroid_set = dset.getYcentroidSet(data_idx, object_num)
    
                    # Handle NaN values
                    if np.isnan(test_features).any():
                        print("[WARNING] Found NaN values in features, cleaning...")
                        test_features = np.nan_to_num(test_features, nan=0.0)
    
                    # Predict ALL nuclei using loaded model
                    print("[PREDICT_ONLY] Predicting all nuclei...")
                    t0 = time()
                    predictions = loaded_model.predict(test_features)
                    probabilities = loaded_model.predict_proba(test_features)
                    t1 = time()
                    print(f"[PREDICT_ONLY] Prediction took {t1 - t0:.2f} seconds")
    
                    # Count results
                    positive_count = int((predictions > 0).sum())
                    negative_count = int((predictions == 0).sum())
    
                    print(f"[PREDICT_ONLY] Generated {len(predictions)} predictions")
                    print(f"[PREDICT_ONLY] Positive: {positive_count}, Negative: {negative_count}")
    
                    # Format results for React
                    data = {
                        'success': True,
                        'slide_name': slide_name,
                        'total_count': len(predictions),
                        'positive_count': positive_count,
                        'negative_count': negative_count,
                        'predictions': []
                    }
    
                    # Store predictions with centroids
                    for i in range(len(predictions)):
                        pred_obj = {
                            'index': i,
                            'x': float(x_centroid_set[i][0]),
                            'y': float(y_centroid_set[i][0]),
                            'prediction': 'positive' if predictions[i] > 0 else 'negative',
                            'probability': float(probabilities[i][1])
                        }
                        data['predictions'].append(pred_obj)
    
                    # Store in Redis
                    db.set(q_id, json.dumps(data))
                    print(f"[PREDICT_ONLY] Results stored in Redis with key: {q_id}")
    
                    db.ltrim(set.REQUEST_QUEUE, len(queue), -1)
                    print("[PREDICT_ONLY] Complete!\n")

            else:
                    print(f"[WARNING] Unknown target: {target}")
                    data = {'success': False, 'error': f'Unknown target: {target}'}
                    db.set(q_uid, json.dumps(data))
                    db.ltrim(set.REQUEST_QUEUE, len(queue), -1)

if __name__ == "__main__":
    run()
