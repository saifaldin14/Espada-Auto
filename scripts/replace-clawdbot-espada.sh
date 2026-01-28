#!/bin/bash

# Script to replace espada references with espada
# Usage: ./scripts/replace-espada-espada.sh

set -e

echo "🔄 Starting Espada → Espada rebranding..."

echo "🔧 Replacing 'Espada' → 'Espada'..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.mdx" -o -name "*.yml" -o -name "*.yaml" -o -name "*.toml" -o -name "*.xml" -o -name "*.plist" -o -name "*.swift" -o -name "*.kt" -o -name "*.kts" -o -name "*.gradle" -o -name "*.sh" -o -name "*.py" -o -name "*.html" -o -name "*.css" -o -name "*.txt" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -not -path "./.pnpm/*" \
  -not -path "./.next/*" \
  -not -path "./build/*" \
  -not -path "./coverage/*" \
  -not -path "./.turbo/*" \
  -not -path "./Swabble/*" \
  -print0 | xargs -0 sed -i '' 's/Espada/Espada/g'

echo "🔧 Replacing 'espada' → 'espada'..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.mdx" -o -name "*.yml" -o -name "*.yaml" -o -name "*.toml" -o -name "*.xml" -o -name "*.plist" -o -name "*.swift" -o -name "*.kt" -o -name "*.kts" -o -name "*.gradle" -o -name "*.sh" -o -name "*.py" -o -name "*.html" -o -name "*.css" -o -name "*.txt" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -not -path "./.pnpm/*" \
  -not -path "./.next/*" \
  -not -path "./build/*" \
  -not -path "./coverage/*" \
  -not -path "./.turbo/*" \
  -not -path "./Swabble/*" \
  -print0 | xargs -0 sed -i '' 's/espada/espada/g'

echo "🔧 Replacing 'ESPADA' → 'ESPADA'..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.mdx" -o -name "*.yml" -o -name "*.yaml" -o -name "*.toml" -o -name "*.xml" -o -name "*.plist" -o -name "*.swift" -o -name "*.kt" -o -name "*.kts" -o -name "*.gradle" -o -name "*.sh" -o -name "*.py" -o -name "*.html" -o -name "*.css" -o -name "*.txt" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -not -path "./.pnpm/*" \
  -not -path "./.next/*" \
  -not -path "./build/*" \
  -not -path "./coverage/*" \
  -not -path "./.turbo/*" \
  -not -path "./Swabble/*" \
  -print0 | xargs -0 sed -i '' 's/ESPADA/ESPADA/g'

echo "🔧 Handling special cases..."

# Fix workspace directory name - preserve moltbot-main
echo "🔧 Fixing workspace directory name..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.mdx" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -print0 | xargs -0 sed -i '' 's/espada-main/moltbot-main/g'

# Important: Preserve the package.json name as "espada" - this is special
echo "🔧 Preserving espada package name..."
find . -name "package.json" -not -path "./node_modules/*" -print0 | xargs -0 sed -i '' 's/"name": "espada"/"name": "espada"/g'

# Verify changes
echo "🔍 Verifying changes..."

# Check for remaining espada references
REMAINING_COUNT=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" \) \
  -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" \
  -exec grep -l "Espada\|espada\|ESPADA" {} \; 2>/dev/null | wc -l)

# Check for successful Espada replacements  
ESPADA_COUNT=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" \) \
  -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" \
  -exec grep -l "Espada\|espada\|ESPADA" {} \; 2>/dev/null | wc -l)

echo "✅ Espada → Espada rebranding complete!"
echo "📋 Summary:"
echo "   • Files with Espada references: $ESPADA_COUNT"
echo "   • Remaining Espada references: $REMAINING_COUNT"

if [ "$REMAINING_COUNT" -gt 0 ]; then
  echo "⚠️  Files with remaining Espada references:"
  find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" \) \
    -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" \
    -exec grep -l "Espada\|espada\|ESPADA" {} \; 2>/dev/null | head -10
fi

echo ""
echo "💡 Next steps:"
echo "   1. Run tests: pnpm test"
echo "   2. Check build: pnpm build" 
echo "   3. Review git diff"
echo "   4. Search for missed refs: git grep -i espada"