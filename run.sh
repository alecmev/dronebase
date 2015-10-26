#!/bin/bash
docker-compose run app node_modules/.bin/babel-node examples/$1.js ${@:2}
