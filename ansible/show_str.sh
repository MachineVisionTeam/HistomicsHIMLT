#!/bin/bash

echo "========================================"
echo "  Repository Structure (Tree View)"
echo "========================================"
echo ""

# Function to display tree structure
show_tree() {
    find . -path ./.git -prune -o -print | sort | sed '1d;s/^\.//;s/\/\([^/]*\)$/|-- \1/;s/\/[^/|]*/|   /g'
}

show_tree

echo ""
echo "========================================"
echo "  File Count by Directory"
echo "========================================"
echo ""

# Count files in each directory
for dir in app ml frontend config systemd docs ansible; do
    if [ -d "$dir" ]; then
        count=$(find "$dir" -type f | wc -l)
        echo "  $dir/: $count files"
    fi
done

echo ""
echo "Total files: $(find . -type f | grep -v .git | wc -l)"
echo "Total size: $(du -sh . | cut -f1)"
