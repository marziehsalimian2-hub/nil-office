import sanitizeHtml from "sanitize-html";

/**
 * Sanitize letter body HTML coming from the rich-text editor before it's
 * stored. draft_text is rendered back with dangerouslySetInnerHTML, so
 * this is the only line of defense against stored XSS.
 */
export function sanitizeLetterHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "u", "ul", "ol", "li", "blockquote", "span", "div"],
    allowedAttributes: {
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(right|left|center|justify)$/],
      },
    },
  });
}
