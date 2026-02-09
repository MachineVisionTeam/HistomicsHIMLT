"""
Network class - Random Forest Implementation

Initialize Random Forest model.
Perform train model.
Return predicted probabilities/Predicted labels.
"""

import numpy as np
from sklearn.ensemble import RandomForestClassifier
import joblib
import os

CHECKPOINT_DIR = os.environ.get('CHECKPOINT_DIR', './checkpoints')
class Network():

    def __init__(self):
        # Random Forest parameters
        self.n_estimators = 100
        self.max_depth = None
        self.min_samples_split = 2
        self.min_samples_leaf = 1
        self.random_state = 145
        self.n_jobs = -1  # Use all CPU cores
        
        self.model = None
        self.classifier = None
        
        # Create checkpoints directory if it doesn't exist
        os.makedirs(CHECKPOINT_DIR, exist_ok=True)

    def params_setting(self, q):
        """Update parameters from user input"""
        if "n_estimators" in q:
            self.n_estimators = int(q["n_estimators"])
        if "max_depth" in q:
            self.max_depth = int(q["max_depth"]) if q["max_depth"] != "None" else None
        if "min_samples_split" in q:
            self.min_samples_split = int(q["min_samples_split"])
        if "min_samples_leaf" in q:
            self.min_samples_leaf = int(q["min_samples_leaf"])

    def getParams(self):
        """Get current parameters"""
        data = {}
        data['n_estimators'] = str(self.n_estimators)
        data['max_depth'] = str(self.max_depth)
        data['min_samples_split'] = str(self.min_samples_split)
        data['min_samples_leaf'] = str(self.min_samples_leaf)
        return data

    def setParams(self, q):
        """Set parameters from list"""
        if len(q) >= 4:
            self.n_estimators = int(q[0])
            self.max_depth = int(q[1]) if q[1] != "None" else None
            self.min_samples_split = int(q[2])
            self.min_samples_leaf = int(q[3])

    def init_model(self):
        """Initialize Random Forest model"""
        self.model = RandomForestClassifier(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            min_samples_split=self.min_samples_split,
            min_samples_leaf=self.min_samples_leaf,
            random_state=self.random_state,
            n_jobs=self.n_jobs
        )

    def loading_model(self, path):
        """Load saved Random Forest model"""
        self.model = joblib.load(path)

    def saving_model(self, path):
        """Save Random Forest model"""
        joblib.dump(self.model, path)


    def train_model(self, features, labels, classifier):
        """Train the Random Forest model"""
        import numpy as np
        
        self.classifier = classifier
        
        # Initialize model if not already done
        if self.model is None:
            self.init_model()
        
        # Handle NaN values
        if np.isnan(features).any():
            print(f"[WARNING] Found NaN values in features, cleaning...")
            features = np.nan_to_num(features, nan=0.0)
        
        print(f"[INFO] Training on {len(features)} samples with {features.shape[1]} features")
        
        # Train the model
        self.model.fit(features, labels)
        
        # Save the model
        checkpoint_path = os.path.join(CHECKPOINT_DIR, f"{self.classifier}.pkl")
        joblib.dump(self.model, checkpoint_path)
        print(f"[INFO] Model saved to {checkpoint_path}")

    def predict_prob(self, features):
        """Predict probabilities for positive class"""
        '''if self.classifier:
            checkpoint_path = f"./checkpoints/{self.classifier}.pkl"
            self.model = joblib.load(checkpoint_path)
            predicts_prob = self.model.predict_proba(features)[:, 1]  # Probability of positive class
            return predicts_prob'''
        import numpy as np
    
        if self.classifier:
            checkpoint_path = os.path.join(CHECKPOINT_DIR, f"{self.classifier}.pkl")
            self.model = joblib.load(checkpoint_path)
        
        # Handle NaN in prediction features
            if np.isnan(features).any():
                print(f"[WARNING] Found NaN in prediction features, cleaning...")
                features = np.nan_to_num(features, nan=0.0)
        
            predicts_prob = self.model.predict_proba(features)[:, 1]
            return predicts_prob
        else:
            raise ValueError("No classifier loaded")

    def predict(self, features):
        """Predict class labels"""
        '''if self.classifier:
            checkpoint_path = f"./checkpoints/{self.classifier}.pkl"
            self.model = joblib.load(checkpoint_path)
            predicts = self.model.predict(features)
            return predicts'''
        import numpy as np
    
        if self.classifier:
            checkpoint_path = os.path.join(CHECKPOINT_DIR, f"{self.classifier}.pkl")
            self.model = joblib.load(checkpoint_path)
        
        # Handle NaN in prediction features
            if np.isnan(features).any():
                print(f"[WARNING] Found NaN in prediction features, cleaning...")
                features = np.nan_to_num(features, nan=0.0)
        
            predicts = self.model.predict(features)
            return predicts
        else:
            raise ValueError("No classifier loaded")
