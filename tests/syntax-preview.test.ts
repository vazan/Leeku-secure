import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TextFilePreview, {
  getPreviewLanguage,
} from "../src/app/shared/components/common/text-file-preview";

test("maps web and application source files to syntax grammars", () => {
  assert.equal(getPreviewLanguage("index.html"), "xml");
  assert.equal(getPreviewLanguage("styles.scss"), "scss");
  assert.equal(getPreviewLanguage("dashboard.tsx"), "typescript");
  assert.equal(getPreviewLanguage("settings.yaml"), "yaml");
  assert.equal(getPreviewLanguage("query.sql"), "sql");
});

test("maps known extensionless build files and leaves plain text uncolored", () => {
  assert.equal(getPreviewLanguage("Dockerfile"), "dockerfile");
  assert.equal(getPreviewLanguage("Makefile"), "makefile");
  assert.equal(getPreviewLanguage("server.log"), null);
  assert.equal(getPreviewLanguage("notes.txt"), null);
});

test("renders escaped HTML source with syntax token classes", () => {
  const markup = renderToStaticMarkup(
    createElement(TextFilePreview, {
      fileName: "index.html",
      preview: {
        kind: "text",
        content: '<main class="preview">Hello</main>',
      },
    }),
  );

  assert.match(markup, /hljs-tag/);
  assert.match(markup, /hljs-name/);
  assert.doesNotMatch(markup, /<main class="preview">/);
});