import os
from dotenv import load_dotenv

# Get the directory where settings.py is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Navigate to project root and config directory
PROJECT_ROOT = os.path.dirname(BASE_DIR)  
ENV_PATH = os.path.join(PROJECT_ROOT, 'config', '.env.prod')

# Load environment variables from .env
if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH)
    print(f"Loaded config from: {ENV_PATH}")
else:
    print(f"No .env file at {ENV_PATH}, using system environment")
    load_dotenv()

class Settings():

    def __init__(self):

        # initialize redis settings
        self.REDIS_HOST = "localhost"
        self.REDIS_PORT = 6379
        self.REDIS_DB = 0
        self.MYSQL_HOST = os.getenv('DB_HOST', 'localhost')
        self.MYSQL_USER = os.getenv('DB_USER', 'newhistomics')  
        self.MYSQL_PASSWORD = os.getenv('DB_PASSWORD', '')

        # initialize constants
        self.REQUEST_QUEUE = "REQUEST_QUEUE"
        self.REQUEST_START = 0
        self.REQUEST_END = 100
        self.SLEEP = 0.5

        # initialize datasets
        self.FEATURE_DIM = 64
        self.IS_HEATMAP = False
        self.DATASET_DIR = os.getenv('DATA_DIR', '/data/')
