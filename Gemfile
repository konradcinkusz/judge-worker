source "https://rubygems.org"

# Docs site only (GitHub Pages, see docs-site/ and .github/workflows/docs.yml).
# Unrelated to the TypeScript worker's own toolchain (see package.json).
gem "jekyll", "~> 4.3"
gem "just-the-docs", "~> 0.8"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-sitemap"
end

# Ruby 3.4+ dropped webrick from the standard library; jekyll serve needs it locally.
gem "webrick", "~> 1.8"
