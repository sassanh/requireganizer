import { configure } from "mobx";
import { getSnapshot, setLivelinessChecking } from "mobx-state-tree";
import React from "react";
import ReactDOM from "react-dom/client";
import { Store } from "store/index";
import App from "./App";
import "./index.css";
import reportWebVitals from "./reportWebVitals";

setLivelinessChecking("error");
configure({
  enforceActions: "always",
  computedRequiresReaction: true,
  observableRequiresReaction: true,
});

let store = Store.create();

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

function renderApp() {
  root.render(
    <React.StrictMode>
      <App store={store} />
    </React.StrictMode>
  );
}

renderApp();

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

if (module.hot) {
  module.hot.accept(["./App"], () => {
    renderApp();
  });

  module.hot.accept(["./store"], () => {
    const snapshot = getSnapshot(store);
    store = Store.create(snapshot);
    renderApp();
  });
}
