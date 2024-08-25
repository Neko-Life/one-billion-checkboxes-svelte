#!/bin/bash

npm run build
rm -rf dist/build
mv build dist
cp package.json package-lock.json dist
tar -cvzf dist.tar.gz dist/
