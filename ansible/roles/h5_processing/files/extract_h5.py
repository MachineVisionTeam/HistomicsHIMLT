#!/usr/bin/env python3
import h5py
import sys

h5_file = sys.argv[1] if len(sys.argv) > 1 else 'combined_format.h5'
output_file = sys.argv[2] if len(sys.argv) > 2 else 'boundary.txt'

print(f"Reading: {h5_file}")

with h5py.File(h5_file, 'r') as f:
    slides = f['slide_name'][:]
    x = f['x_centroid'][:]
    y = f['y_centroid'][:]
    # Try to find boundary data
    boundary = f['boundary'][:] if 'boundary' in f else [''] * len(slides)
    
    n_records = len(slides)
    print(f"Extracting {n_records:,} records...")
    
    with open(output_file, 'w', encoding='utf-8', newline='\n') as out:
        for i in range(n_records):
            slide = slides[i].decode('utf-8') if isinstance(slides[i], bytes) else str(slides[i])
            x_val = float(x[i])
            y_val = float(y[i])
            bnd = boundary[i].decode('utf-8') if isinstance(boundary[i], bytes) else str(boundary[i])
            out.write(f"{slide}\t{x_val:10.1f}\t{y_val:10.1f}\t{bnd.strip()}\n")
            
            if (i + 1) % 10000 == 0:
                print(f"  Processed {i + 1:,}/{n_records:,}")

print(f"\n Created {output_file}")
print(f"Total records: {n_records:,}")
