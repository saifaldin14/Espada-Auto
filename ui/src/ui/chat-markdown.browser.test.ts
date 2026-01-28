import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EspadaApp } from "./app";

const originalConnect = EspadaApp.prototype.connect;

function mountApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("espada-app") as EspadaApp;
  document.body.append(app);
  return app;
}

beforeEach(() => {
  EspadaApp.prototype.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  window.__ESPADA_CONTROL_UI_BASE_PATH__ = undefined;
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  EspadaApp.prototype.connect = originalConnect;
  window.__ESPADA_CONTROL_UI_BASE_PATH__ = undefined;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("chat markdown rendering", () => {
  it("renders markdown inside tool output sidebar", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const timestamp = Date.now();
    app.chatMessages = [
      {
        role: "assistant",
        content: [
          { type: "toolcall", name: "noop", arguments: {} },
          { type: "toolresult", name: "noop", text: "Hello **world**" },
        ],
        timestamp,
      },
    ];

    await app.updateComplete;

    const toolCards = Array.from(
      app.querySelectorAll<HTMLElement>(".chat-tool-card"),
    );
    const toolCard = toolCards.find((card) =>
      card.querySelector(".chat-tool-card__preview, .chat-tool-card__inline"),
    );
    expect(toolCard).not.toBeUndefined();
    toolCard?.click();

    await app.updateComplete;

    const strong = app.querySelector(".sidebar-markdown strong");
    expect(strong?.textContent).toBe("world");
  });
});
