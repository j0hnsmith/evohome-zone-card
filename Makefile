.PHONY: test test-watch

help:
	@grep --no-filename -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
.PHONY: help

test:  ## run tests
	@if command -v npm >/dev/null 2>&1; then \
		npm test; \
	elif command -v bun >/dev/null 2>&1; then \
		bun x vitest run --environment jsdom; \
	else \
		echo "No supported JS runtime found (need npm or bun)"; \
		exit 1; \
	fi

test-watch:  ## run tests each time a file changes
	@if command -v npm >/dev/null 2>&1; then \
		npx vitest --environment jsdom; \
	elif command -v bun >/dev/null 2>&1; then \
		bun x vitest --environment jsdom; \
	else \
		echo "No supported JS runtime found (need npm or bun)"; \
		exit 1; \
	fi
