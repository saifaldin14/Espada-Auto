/**
 * IQL — Lexical Analyzer (Tokenizer)
 *
 * Transforms IQL source text into a stream of tokens.
 * Handles keywords, identifiers, strings (single/double quoted),
 * numbers (with optional $ prefix and /mo suffix), operators, and punctuation.
 */

import type { Token, TokenType } from "./types.js";

const KEYWORDS = new Set([
  "FIND",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "MATCHES",
  "OF",
  "FROM",
  "TO",
  "AT",
  "DIFF",
  "WITH",
  "NOW",
  "BY",
  "SUMMARIZE",
  "LIMIT",
  "PATH",
  "RESOURCES",
  "DOWNSTREAM",
  "UPSTREAM",
  "TRUE",
  "FALSE",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COUNT",
]);

/**
 * Tokenize an IQL source string.
 */
export class IQLLexer {
  private input: string;
  private pos = 0;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.input[this.pos];

      // Single-line comments (# or --)
      if (ch === "#" || (ch === "-" && this.peek(1) === "-")) {
        this.skipToEndOfLine();
        continue;
      }

      // String literals
      if (ch === "'" || ch === '"') {
        this.readString(ch);
        continue;
      }

      // Numbers (with optional $ prefix and /mo suffix)
      if (ch === "$" || this.isDigit(ch)) {
        this.readNumber();
        continue;
      }

      // Two-character operators
      if (ch === "!" && this.peek(1) === "=") {
        this.emit("OPERATOR", "!=", this.pos);
        this.pos += 2;
        continue;
      }
      if (ch === ">" && this.peek(1) === "=") {
        this.emit("OPERATOR", ">=", this.pos);
        this.pos += 2;
        continue;
      }
      if (ch === "<" && this.peek(1) === "=") {
        this.emit("OPERATOR", "<=", this.pos);
        this.pos += 2;
        continue;
      }

      // Single-character operators
      if (ch === "=" || ch === ">" || ch === "<") {
        this.emit("OPERATOR", ch, this.pos);
        this.pos++;
        continue;
      }

      // Punctuation
      if (ch === "(") {
        this.emit("LPAREN", "(", this.pos);
        this.pos++;
        continue;
      }
      if (ch === ")") {
        this.emit("RPAREN", ")", this.pos);
        this.pos++;
        continue;
      }
      if (ch === ",") {
        this.emit("COMMA", ",", this.pos);
        this.pos++;
        continue;
      }
      if (ch === ".") {
        this.emit("DOT", ".", this.pos);
        this.pos++;
        continue;
      }
      if (ch === "*") {
        this.emit("STAR", "*", this.pos);
        this.pos++;
        continue;
      }

      // Identifiers and keywords
      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      throw new IQLSyntaxError(
        `Unexpected character '${ch}'`,
        this.pos,
        this.input,
      );
    }

    this.emit("EOF", "", this.pos);
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private skipToEndOfLine(): void {
    while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
      this.pos++;
    }
  }

  private readString(quote: string): void {
    const start = this.pos;
    this.pos++; // skip opening quote
    let value = "";
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === "\\" && this.pos + 1 < this.input.length) {
        this.pos++; // skip backslash
        value += this.input[this.pos];
      } else {
        value += this.input[this.pos];
      }
      this.pos++;
    }
    if (this.pos >= this.input.length) {
      throw new IQLSyntaxError("Unterminated string literal", start, this.input);
    }
    this.pos++; // skip closing quote
    this.emit("STRING", value, start);
  }

  private readNumber(): void {
    const start = this.pos;
    // Skip $ prefix (cost literal: $1000/mo)
    if (this.input[this.pos] === "$") this.pos++;

    let numStr = "";
    while (
      this.pos < this.input.length &&
      (this.isDigit(this.input[this.pos]) || this.input[this.pos] === ".")
    ) {
      numStr += this.input[this.pos];
      this.pos++;
    }

    if (numStr === "") {
      throw new IQLSyntaxError("Expected number after '$'", start, this.input);
    }

    // Skip /mo suffix (cost annotation — purely cosmetic)
    if (
      this.pos < this.input.length &&
      this.input[this.pos] === "/" &&
      this.pos + 2 < this.input.length &&
      this.input.slice(this.pos, this.pos + 3).toLowerCase() === "/mo"
    ) {
      this.pos += 3;
    }

    this.emit("NUMBER", numStr, start);
  }

  private readIdentifier(): void {
    const start = this.pos;
    let value = "";
    while (this.pos < this.input.length && this.isIdentPart(this.input[this.pos])) {
      value += this.input[this.pos];
      this.pos++;
    }
    const upper = value.toUpperCase();
    if (KEYWORDS.has(upper)) {
      this.emit("KEYWORD", upper, start);
    } else {
      this.emit("IDENTIFIER", value, start);
    }
  }

  private peek(offset: number): string | undefined {
    return this.input[this.pos + offset];
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch: string): boolean {
    return /[a-zA-Z_]/.test(ch);
  }

  private isIdentPart(ch: string): boolean {
    return /[a-zA-Z0-9_-]/.test(ch);
  }

  private emit(type: TokenType, value: string, position: number): void {
    this.tokens.push({ type, value, position });
  }
}

/**
 * Syntax error thrown by the IQL lexer or parser.
 * Includes position and source context for helpful error messages.
 */
export class IQLSyntaxError extends Error {
  readonly position: number;
  readonly source: string;

  constructor(message: string, position: number, source: string) {
    const contextStart = Math.max(0, position - 20);
    const contextEnd = Math.min(source.length, position + 20);
    const context = source.slice(contextStart, contextEnd);
    super(
      `IQL syntax error at position ${position}: ${message}\n  near: ...${context}...`,
    );
    this.name = "IQLSyntaxError";
    this.position = position;
    this.source = source;
  }
}
