Project Overview
What is HIMLT?
It is a modern web-based system for analyzing whole-slide images (WSI) of tissue samples Display gigapixel medical images smoothly in the browser.
•	Detect and highlight cell nuclei automatically.
•	Load precomputed nuclei coordinates from HDF5 files.
•	Let pathologists/Researcher’s select positive/negative examples.
•	Train AI models with Random Forest classifier to classify nuclei across entire slides.
•	Visualize predictions in real-time.
________________________________________

Quick Start (For Deployment)
Prerequisites
- Linux (Ubuntu 20.04+) or macOS (10.15+)
- Python 3.8+
- MySQL 5.7+
- Redis
- Apache2

Deployment with Ansible
```bash
# Clone repository
git clone <to be edited>
cd HistomicsHIMLT

# Configure deployment
cd ansible
cp inventory/hosts.example inventory/hosts
nano inventory/hosts   # Edit with the server details

# Deploy
ansible-playbook -i inventory/hosts deploy.yml
See `docs/DEPLOYMENT.md` for detailed instructions.


Development Setup
## Backend Development
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp config/.env.prod.example config/.env.prod
nano config/.env.prod  # Add your credentials

# Run Flask API
cd app
python app.py

# Run ML Worker (in another terminal)
cd ml
python run_model_server.py

## Frontend Development
See `frontend/README.md` for React development setup.


## Repository Structure
HistomicsHIMLT
|-- ansible
|-- app
|   |-- app.py
|   |-- histomics_integration.py
|   |-- static
|   |   |-- assets
|   |   |   |-- index-1yRzYoYq.js
|   |   |   |-- index-CB8Rqdao.css
|   |   |   |-- index-D3icpN35.js
|   |   |   |-- index-Db-49GIo.css
|   |   |-- index.html
|-- config
|   |-- .env.prod.example
|-- docs
|   |-- API.md
|   |-- DEPLOYMENT.md
|   |-- DEVELOPMENT.md
|-- frontend
|   |-- index.html
|   |-- package.json
|   |-- package-lock.json
|   |-- postcss.config.js
|   |-- src
|   |   |-- App.tsx
|   |   |-- index.css
|   |   |-- main.tsx
|   |-- tailwind.config.js
|   |-- tsconfig.json
|   |-- tsconfig.node.json
|   |-- vite.config.ts
|-- .gitignore
|-- ml
|   |-- dataset.py
|   |-- networks.py
|   |-- run_model_server.py
|   |-- settings.py
|-- requirements.txt
|-- systemd
|   |-- histomics-flask.service
|   |-- histomics-ml.service

 Technology Stack
## Backend
- **Flask** - Web framework
- **MySQL** - Database
- **Redis** - Job queue
- **scikit-learn** - Random Forest classifier
- **h5py** - HDF5 file handling

## Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **OpenSeadragon** - Image viewer
- **Tailwind CSS** - Styling

## Deployment
- **Ansible** - Automation
- **Systemd** - Service management
- **Apache** - Web server
- **Gunicorn** - WSGI server

## Documentation
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [API Documentation](docs/API.md)
- [Frontend Development](frontend/README.md)

