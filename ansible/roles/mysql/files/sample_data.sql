-- Sample Data - Clean version without hardcoded IDs
USE histomics_db;

-- GBM Dataset - Let AUTO_INCREMENT handle the ID
INSERT IGNORE INTO datasets (name, features_file, pca_file, superpixel_size) 
VALUES ('GBM', 'GBM/gbm_features.h5', 'Unassigned', 8);

-- Get the dataset_id for GBM (whether just inserted or already existed)
SET @gbm_dataset_id = (SELECT id FROM datasets WHERE name = 'GBM');

-- 2 GBM Slides - Let AUTO_INCREMENT handle the IDs
INSERT IGNORE INTO slides (name, patient, x_size, y_size, pyramid_path, scale) VALUES 
('TCGA-06-5410-01Z-00-DX1', NULL, 103598, 31436, '/data/GBM/TCGA-06-5410-01Z-00-DX1.6fca0716-7c1d-4545-bdde-9cdb3aa6aa5f.tif', NULL),
('TCGA-19-2620-01Z-00-DX1', NULL, 82495, 22641, '/data/GBM/TCGA-19-2620-01Z-00-DX1.b52311cf-5861-4653-9d87-bcc3389874ef.tif', NULL);

-- Get slide IDs
SET @slide1_id = (SELECT id FROM slides WHERE name = 'TCGA-06-5410-01Z-00-DX1');
SET @slide2_id = (SELECT id FROM slides WHERE name = 'TCGA-19-2620-01Z-00-DX1');

-- Link slides to GBM dataset
INSERT IGNORE INTO dataset_slides (slide_id, dataset_id) VALUES 
(@slide1_id, @gbm_dataset_id),
(@slide2_id, @gbm_dataset_id);

-- Show summary
SELECT 
    'Sample data imported' AS Status,
    (SELECT COUNT(*) FROM datasets) AS total_datasets,
    (SELECT COUNT(*) FROM slides) AS total_slides,
    (SELECT COUNT(*) FROM dataset_slides) AS total_links;
