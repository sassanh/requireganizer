import { render, screen } from "@testing-library/react";
import { Store } from "store";

import App from "./App";

test("renders learn react link", () => {
  const store = Store.create();
  render(<App store={store} />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});
