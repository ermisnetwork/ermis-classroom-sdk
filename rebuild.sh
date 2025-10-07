#!/bin/bash

npx rollup -c

if [ $? -ne 0 ]; then
  echo "Rollup build failed!"
  exit 1
fi



rm -rf ./examples/dist

cp -r ./dist ./examples/dist

echo "Build completed successfully and copied to examples/dist/ermis-player.min.js"