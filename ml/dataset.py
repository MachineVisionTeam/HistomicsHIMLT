"""
Dataset class

Dataset loader for histopathology H5 files.

Loads nuclei features (64-dim), centroids (x,y), and slide metadata from H5 files.
Handles flexible slide name matching (with/without file extensions)
"""

import h5py
import numpy as np
import settings

class Dataset():
    def __init__(self, path):
        self.f = h5py.File(path, 'r')

        # Load features - try multiple possible keys
        feature_keys = ['features', 'combined_features']
        feature_loaded = False

        for key in feature_keys:
            if key in self.f:
                self.features = self.f[key][:]
                print(f"[INFO] Loaded {key}: {self.features.shape}")
                feature_loaded = True
                break

        if not feature_loaded:
            raise KeyError(
                f"None of the feature datasets found: {feature_keys}\n"
                f"Available keys: {list(self.f.keys())}"
            )

        # Load centroids
        if 'x_centroid' in self.f and 'y_centroid' in self.f:
            self.x_centroid = self.f['x_centroid'][:]
            self.y_centroid = self.f['y_centroid'][:]
    
            # Ensure 2D format (n_objects, 1) for consistency
            if self.x_centroid.ndim == 1:
                self.x_centroid = self.x_centroid.reshape(-1, 1)
                print(f"[INFO] Reshaped x_centroid to 2D: {self.x_centroid.shape}")
    
            if self.y_centroid.ndim == 1:
                self.y_centroid = self.y_centroid.reshape(-1, 1)
                print(f"[INFO] Reshaped y_centroid to 2D: {self.y_centroid.shape}")
    
            print(f"[INFO] Loaded centroids: {len(self.x_centroid)} points")
        else:
            raise KeyError("'x_centroid' or 'y_centroid' not found in HDF5 file")
        
        # Load slide indexing - handle both BRCA and GBM formats
        if 'slideIdx' in self.f and 'slides' in self.f and 'dataIdx' in self.f:
            # BRCA format - has full indexing structure
            self.slideIdx = self.f['slideIdx'][:]
            self.slides = self.f['slides'][:]
            self.dataIdx = self.f['dataIdx'][:]
            print(f"[INFO] Loaded slide indexing: {len(self.slides[0]) if self.slides.shape[0] == 1 else len(self.slides)} slides")
        else:
            # GBM format - generate indexing from slide_name
            print("[WARNING] Slide indexing (slideIdx/slides/dataIdx) not found")

            if 'slide_name' in self.f:
                print("[INFO] Generating slide indexing from 'slide_name'...")
                slide_names = self.f['slide_name'][:]

                # Decode if bytes
                if slide_names.dtype.kind == 'S':
                    slide_names = np.array([s.decode('ASCII') for s in slide_names])

                # Get unique slides
                unique_slides = np.unique(slide_names)
                print(f"[INFO] Found {len(unique_slides)} unique slides in 'slide_name'")

                # Create slides array (BRCA format)
                self.slides = np.array([[s.encode('ASCII') if isinstance(s, str) else s for s in unique_slides]])

                # Create slideIdx (map each nucleus to slide index)
                self.slideIdx = np.zeros(len(slide_names), dtype=int)
                slide_to_idx = {slide: i for i, slide in enumerate(unique_slides)}
                for i, slide_name in enumerate(slide_names):
                    self.slideIdx[i] = slide_to_idx[slide_name]

                # Create dataIdx (start index for each slide)
                self.dataIdx = np.zeros((len(unique_slides), 1), dtype=int)
                for i, slide in enumerate(unique_slides):
                    first_idx = np.where(slide_names == slide)[0][0]
                    self.dataIdx[i, 0] = first_idx

                print(f"[INFO] Generated slide indexing for {len(unique_slides)} slides")
            else:
                # No slide information - treat as single slide
                print("[WARNING] No slide information found, treating as single slide")
                n_objects = len(self.features)
                self.slides = np.array([['unknown_slide'.encode('ASCII')]])
                self.slideIdx = np.zeros(n_objects, dtype=int)
                self.dataIdx = np.array([[0]], dtype=int)

        # Load normalization stats - try different names
        if 'wsi_mean' in self.f:
            self.wsi_mean = self.f['wsi_mean'][:]
            print("[INFO] Loaded wsi_mean from HDF5")
        elif 'mean' in self.f:
            self.wsi_mean = self.f['mean'][:]
            print("[INFO] Loaded mean from HDF5 (as wsi_mean)")
        else:
            # Default ImageNet mean for VGG16
            print("[WARNING] wsi_mean not found, using ImageNet defaults")
            self.wsi_mean = np.array([[0.485, 0.456, 0.406]], dtype=np.float32)

        # Try both wsi_stddev and wsi_std
        if 'wsi_stddev' in self.f:
            self.wsi_stddev = self.f['wsi_stddev'][:]
            print("[INFO] Loaded wsi_stddev from HDF5")
        elif 'wsi_std' in self.f:
            self.wsi_stddev = self.f['wsi_std'][:]
            print("[INFO] Loaded wsi_std from HDF5 (as wsi_stddev)")
        elif 'std_dev' in self.f:
            self.wsi_stddev = self.f['std_dev'][:]
            print("[INFO] Loaded std_dev from HDF5 (as wsi_stddev)")
        else:
            # Default ImageNet std for VGG16
            print("[WARNING] wsi_stddev not found, using ImageNet defaults")
            self.wsi_stddev = np.array([[0.229, 0.224, 0.225]], dtype=np.float32)

        self.n_slides = len(self.dataIdx)
        self.n_objects = len(self.slideIdx)

        s = settings.Settings()
        self.FEATURE_DIM = s.FEATURE_DIM

        print(f"[INFO] Dataset loaded: {self.n_slides} slides, {self.n_objects} objects")

    def getSlideIdx(self, slide):
        """
        Find slide index with flexible matching for extensions
        """
        # Helper function to try matching
        def try_match(slide_name):
            if self.slides.shape[0] == 1:
                # Decode bytes to strings for comparison
                decoded_slides = [s.decode('ASCII') if isinstance(s, bytes) else s for s in self.slides[0]]
                matches = [i for i, s in enumerate(decoded_slides) if s == slide_name]
                return np.array(matches)
            else:
                matches = np.argwhere(self.slides == slide_name)
                if len(matches) > 0:
                    matches = matches[:, 0]
                return matches

        # Try exact match first
        matches = try_match(slide)
        if len(matches) > 0:
            return int(matches[0])

        # Try without extension
        slide_no_ext = slide.replace('.svs', '').replace('.tif', '').replace('.tiff', '')
        matches = try_match(slide_no_ext)
        if len(matches) > 0:
            print(f"[INFO] Matched slide without extension: {slide_no_ext}")
            return int(matches[0])

        # Try adding .svs extension
        slide_with_svs = slide if slide.endswith('.svs') else slide + '.svs'
        matches = try_match(slide_with_svs)
        if len(matches) > 0:
            print(f"[INFO] Matched slide with .svs extension: {slide_with_svs}")
            return int(matches[0])

        # Try adding .tif extension
        slide_with_tif = slide.replace('.svs', '') + '.tif'
        matches = try_match(slide_with_tif)
        if len(matches) > 0:
            print(f"[INFO] Matched slide with .tif extension: {slide_with_tif}")
            return int(matches[0])

        # No match found - show available slides for debugging
        if self.slides.shape[0] == 1:
            available_slides = [s.decode('ASCII') if isinstance(s, bytes) else s for s in self.slides[0][:10]]
        else:
            available_slides = self.slides[:10].tolist()

        raise ValueError(
            f"Slide '{slide}' not found in HDF5 file.\n"
            f"Available slides (first 10): {available_slides}\n"
            f"Total slides in file: {len(self.slides[0]) if self.slides.shape[0] == 1 else len(self.slides)}"
        )

    def getDataIdx(self, index):
        return self.dataIdx[index][0]

    def getObjNum(self, index):
        if self.n_slides > index + 1:
            num = self.dataIdx[index + 1, 0] - self.dataIdx[index, 0]
        else:
            num = self.n_objects - self.dataIdx[index, 0]
        return num

    def getFeatureSet(self, index, num):
        return self.features[index: index+num]

    def getWSI_Mean(self, index):
        return self.wsi_mean[index][:]

    def getWSI_Std(self, index):
        return self.wsi_stddev[index][:]

    def getXcentroidSet(self, index, num):
        return self.x_centroid[index: index+num]

    def getYcentroidSet(self, index, num):
        return self.y_centroid[index: index+num]

    def getSlideIdxSet(self, index, num):
        return self.slideIdx[index: index+num]
