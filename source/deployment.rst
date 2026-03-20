:doc:`← Back to Overview <readMe>`

Deployment Guide
================

Overview
--------

This guide covers deploying the Histopathology HIMLT application to a production
server using Ansible automation. The deployment installs and configures all required
services on a Linux server.

Services Deployed
~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 20 50 30

   * - Service
     - Purpose
     - Port
   * - Apache
     - Web server, reverse proxy
     - 80
   * - Flask (Gunicorn)
     - REST API backend
     - 5000 (internal)
   * - ML Worker
     - Random Forest training/prediction
     - —
   * - MySQL
     - Database
     - 3306 (internal)
   * - Redis
     - Job queue
     - 6379 (internal)
   * - IIPImage
     - Whole slide image tile server
     - FastCGI


Prerequisites
-------------

Control Machine (where you run Ansible from)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Ansible 2.16+
- Git
- SSH key access to target server (if control machine is different from target)

Target Server Requirements
~~~~~~~~~~~~~~~~~~~~~~~~~~

- Linux server
- Minimum 4 GB RAM
- Minimum 50 GB disk space
- SSH access configured
- Sudo privileges


Pre-Deployment Steps (Manual)
------------------------------

.. note::
   These files must be placed on the **target server** before running deployment.

Step 1 — Copy TIF Image Files
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   # Create directory on target server
   ssh user@server "sudo mkdir -p /data/GBM"

   # Copy TIF files from source
   scp /path/to/TCGA-*.tif user@server:/data/GBM/

   # Set permissions
   ssh user@server "sudo chmod -R 755 /data/GBM"

Step 2 — Copy H5 Features File
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   scp /path/to/gbm_features.h5 user@server:/data/GBM/

Step 3 — Verify Files on Target Server
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   ssh user@server "ls -lh /data/GBM/"

Expected output::

   gbm_features.h5
   TCGA-06-5410-01Z-00-DX1.*.tif
   TCGA-19-2620-01Z-00-DX1.*.tif


Deployment Steps
----------------

Step 1 — Clone Repository
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   git clone https://github.com/MachineVisionTeam/HistomicsHIMLT.git
   cd HistomicsHIMLT/ansible

Step 2 — Configure Inventory
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   cp inventory/hosts.example inventory/hosts
   vi inventory/hosts

Update with your server details:

.. code-block:: ini

   [histomics_servers]
   server1 ansible_host=YOUR_SERVER_IP ansible_ssh_private_key_file=/home/user/.ssh/your_key

   [histomics_servers:vars]
   ansible_user=your_username
   ansible_become=yes
   ansible_become_method=sudo
   ansible_python_interpreter=/usr/bin/python3

Step 3 — Configure Variables
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   nano inventory/group_vars/all.yml

Update these required fields:

.. code-block:: yaml

   # Database
   mysql_root_password: "your_secure_root_password"
   db_password: "your_secure_db_password"

Generate a secure Flask secret key:

.. code-block:: bash

   $ python3 -c "import secrets; print(secrets.token_hex(32))"

Then set the remaining fields:

.. code-block:: yaml

   # Flask
   flask_secret_key: "your_generated_secret_key"

   # User (match your SSH user)
   app_user: your_username
   app_group: your_username

Step 4 — Test Connection
~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   ansible -i inventory/hosts histomics_servers -m ping

Expected: ``server1 | SUCCESS => { "ping": "pong" }``

Step 5 — Run Deployment
~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   ansible-playbook -i inventory/hosts deploy.yml

Deployment takes approximately **20–30 minutes** on a clean server.


What Gets Deployed
------------------

Ansible Roles (in order)
~~~~~~~~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - Role
     - What it does
   * - ``common``
     - OS detection, system packages, directories
   * - ``mysql``
     - MySQL install, database schema, sample data
   * - ``redis``
     - Redis install and configuration
   * - ``python``
     - Python virtual environment, pip dependencies
   * - ``application``
     - Flask API and ML worker code
   * - ``iipimage``
     - IIPImage server for whole slide image tiles
   * - ``apache``
     - Apache web server, proxy configuration
   * - ``services``
     - Systemd services for Flask and ML worker
   * - ``h5_processing``
     - H5 nuclei data extraction and database import

File Locations on Server
~~~~~~~~~~~~~~~~~~~~~~~~~

::

   /opt/histomics-prod/          # Application root
   ├── app/                      # Flask API
   ├── ml/                       # ML Worker
   ├── venv/                     # Python virtual environment
   ├── logs/                     # Application logs
   └── .env.prod                 # Environment configuration

   /var/www/html/histomics/      # React frontend (static files)
   /data/GBM/                    # Image and H5 data files
   /etc/apache2/                 # Apache configuration


Database Schema
---------------

Four tables are created automatically with sample data:

.. code-block:: sql

   datasets        -- GBM dataset metadata
   slides          -- Slide information and pyramid paths
   dataset_slides  -- Junction table linking slides to datasets
   nuclei_boundary -- Nuclei x,y coordinates (populated from H5)


Post-Deployment Verification
-----------------------------

Check All Services
~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   for service in histomics-flask histomics-ml mysql redis apache2; do
       echo -n "$service: "
       sudo systemctl is-active $service
   done

All should show ``active``.

Test Application
~~~~~~~~~~~~~~~~

.. code-block:: bash

   # Test Flask API
   curl http://localhost/api/health

   # Test IIPImage
   curl http://localhost/iipsrv/iipsrv.fcgi

   # Test frontend
   curl -I http://localhost

Check Database
~~~~~~~~~~~~~~

.. code-block:: bash

   mysql -u histomics -p histomics_db

.. code-block:: sql

   SELECT 'datasets' AS tbl, COUNT(*) AS cnt FROM datasets
   UNION ALL
   SELECT 'slides', COUNT(*) FROM slides
   UNION ALL
   SELECT COUNT(*) FROM dataset_slides
   UNION ALL
   SELECT 'nuclei_boundary', COUNT(*) FROM nuclei_boundary;


Deploying Individual Roles
---------------------------

You can re-run specific parts of the deployment using tags:

.. code-block:: bash

   # Re-run only database setup
   ansible-playbook -i inventory/hosts deploy.yml --tags mysql

   # Re-run only H5 processing
   ansible-playbook -i inventory/hosts deploy.yml --tags h5_processing

   # Re-run only services
   ansible-playbook -i inventory/hosts deploy.yml --tags services

   # Skip already-done roles
   ansible-playbook -i inventory/hosts deploy.yml --skip-tags common,mysql,redis


Rollback Using Snapshots
-------------------------

Snapshots can be taken at key stages during initial deployment.

To restore: **VirtualBox → Right-click VM → Snapshots → Select → Restore**


Troubleshooting
---------------

Apache won't start
~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   sudo apache2ctl configtest
   sudo journalctl -xeu apache2.service
   sudo tail -20 /var/log/apache2/error.log

Flask service failing
~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   sudo systemctl status histomics-flask
   sudo journalctl -u histomics-flask -f

MySQL connection issues
~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   mysql -u root -p histomics_db

H5 data not imported
~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   # Check H5 file exists
   ls -lh /data/GBM/gbm_features.h5

   # Re-run H5 processing
   ansible-playbook -i inventory/hosts deploy.yml --tags h5_processing

Check all logs
~~~~~~~~~~~~~~

.. code-block:: bash

   sudo tail -f /opt/histomics-prod/logs/flask/error.log
   sudo tail -f /var/log/apache2/histomics_error.log
   sudo tail -f /var/log/iipsrv.log


Security Notes
--------------

- ``inventory/hosts`` — **Never commit to GitHub** (contains server IPs)
- ``inventory/group_vars/all.yml`` — Commit to GitHub but ensure passwords are changed from default values before deployment. Do not use default placeholder passwords like
  ``CHANGE_THIS_PASSWORD`` in production.
- Flask runs on ``127.0.0.1:5000`` — internal only, not exposed directly
- MySQL and Redis bind to localhost only
- Apache handles all external traffic on port 80
