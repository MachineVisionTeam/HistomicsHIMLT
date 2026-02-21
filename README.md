## Project Overview
What is HIMLT?
It is a modern web-based system for analyzing whole-slide images (WSI) of tissue samples Display gigapixel medical images smoothly in the browser.
•	Detect and highlight cell nuclei automatically.
•	Load precomputed nuclei coordinates from HDF5 files.
•	Let pathologists/Researcher’s select positive/negative examples.
•	Train AI models with Random Forest classifier to classify nuclei across entire slides.
•	Visualize predictions in real-time.
________________________________________


## Repository Structure
```
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
|   |-- DEPLOYMENT.md
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

```
## Technology Stack
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

## See Deployment Guide for full setup and deployment instructions below
- [Deployment Guide](docs/DEPLOYMENT.md)

