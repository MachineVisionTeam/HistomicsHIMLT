#!/usr/bin/env python3
"""
Import nuclei data from H5 file directly to MySQL
"""
import h5py
import pymysql
import argparse
import sys

def import_h5_to_mysql(h5_file, db_host, db_name, db_user, db_password):
    """Import H5 data directly to MySQL using INSERT statements"""
    
    print(f"Reading H5 file: {h5_file}")
    
    # Read H5 file
    with h5py.File(h5_file, 'r') as f:
        slides = f['slide_name'][:]
        x = f['x_centroid'][:]
        y = f['y_centroid'][:]
        
        n_records = len(slides)
        print(f"Found {n_records:,} records in H5 file")
        
        # Connect to MySQL
        print(f"Connecting to MySQL database: {db_name}")
        conn = pymysql.connect(
            host=db_host,
            user=db_user,
            password=db_password,
            database=db_name
        )
        
        try:
            cursor = conn.cursor()
            
            # Batch insert for performance
            batch_size = 1000
            insert_sql = """
                INSERT INTO nuclei_boundary (slide, x, y) 
                VALUES (%s, %s, %s)
            """
            
            batch_data = []
            inserted = 0
            
            for i in range(n_records):
                slide = slides[i].decode('utf-8') if isinstance(slides[i], bytes) else str(slides[i])
                x_val = float(x[i])
                y_val = float(y[i])
                
                batch_data.append((slide, x_val, y_val))
                
                # Insert in batches
                if len(batch_data) >= batch_size:
                    cursor.executemany(insert_sql, batch_data)
                    conn.commit()
                    inserted += len(batch_data)
                    print(f"  Inserted {inserted:,}/{n_records:,} records...")
                    batch_data = []
            
            # Insert remaining records
            if batch_data:
                cursor.executemany(insert_sql, batch_data)
                conn.commit()
                inserted += len(batch_data)
            
            print(f"\n Successfully imported {inserted:,} nuclei records")
            
        finally:
            cursor.close()
            conn.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Import H5 nuclei data to MySQL')
    parser.add_argument('--h5-file', required=True, help='Path to H5 file')
    parser.add_argument('--db-host', required=True, help='MySQL host')
    parser.add_argument('--db-name', required=True, help='Database name')
    parser.add_argument('--db-user', required=True, help='Database user')
    parser.add_argument('--db-password', required=True, help='Database password')
    
    args = parser.parse_args()
    
    try:
        import_h5_to_mysql(
            args.h5_file,
            args.db_host,
            args.db_name,
            args.db_user,
            args.db_password
        )
    except Exception as e:
        print(f" Error: {e}", file=sys.stderr)
        sys.exit(1)
