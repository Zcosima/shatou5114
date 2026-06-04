@echo off
cd /d D:\shatou-handbook
set PNPM_HOME=D:\shatou-handbook\.tools
set npm_config_cache=D:\shatou-handbook\.npm-cache
set PNPM_STORE_DIR=D:\shatou-handbook\.pnpm-store
"C:\Users\cosima\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" node_modules\next\dist\bin\next dev --hostname 127.0.0.1 --port 3000 > D:\shatou-handbook\next-dev.log 2>&1
