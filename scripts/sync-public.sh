#!/bin/bash
# 同步到公开仓库（剔除私有功能）
# 用法: ./scripts/sync-public.sh

set -e

echo "=== Syncing to public repos (stripping private features) ==="

# 1. 确保当前分支干净
if [[ -n $(git status --porcelain) ]]; then
  echo "ERROR: Working tree is dirty. Commit or stash first."
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)
CURRENT_COMMIT=$(git rev-parse HEAD)

# 2. 创建临时分支
TEMP_BRANCH="sync-public-$(date +%s)"
git checkout -b "$TEMP_BRANCH"

# 3. 删除私有文件
rm -f src/core/source-scraper.ts

# 4. 从 aggregator.ts 中移除自动抓取代码
# 移除 import
sed -i '' '/import.*source-scraper/d' src/aggregator.ts

# 移除 Step 0 整个代码块（从 "// Step 0:" 到 "// Step 1:"）
node -e "
const fs = require('fs');
let code = fs.readFileSync('src/aggregator.ts', 'utf8');
const start = code.indexOf('  // Step 0:');
const end = code.indexOf('  // Step 1:');
if (start !== -1 && end !== -1) {
  code = code.substring(0, start) + code.substring(end);
  fs.writeFileSync('src/aggregator.ts', code);
  console.log('Stripped Step 0 from aggregator.ts');
} else {
  console.log('No Step 0 found, skipping');
}
"

# 5. 验证构建
echo "Verifying build..."
npx tsc --noEmit
npm run build:node > /dev/null 2>&1
echo "Build OK"

# 6. 提交到临时分支
git add -A
git commit -m "sync: strip private features for public release" --allow-empty

# 7. 推送到公开仓库
echo "Pushing to origin (Gitee)..."
git push origin "$TEMP_BRANCH":main --force

echo "Pushing to github..."
git push github "$TEMP_BRANCH":main --force

# 8. 切回原分支，删除临时分支
git checkout "$CURRENT_BRANCH"
git branch -D "$TEMP_BRANCH"

echo "=== Done! Public repos updated. ==="
echo "Private repo (main) still at: $CURRENT_COMMIT"
