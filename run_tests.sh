#!/bin/bash
npx eslint --fix src
xvfb-run -a npm test
