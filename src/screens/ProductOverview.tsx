import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Combobox } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import Textarea from "react-textarea-autosize";
import {
  Framework,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  ProgrammingLanguage,
  useStore,
} from "store";

const ProductOverview: React.FunctionComponent = () => {
  const store = useStore();

  const handleProductOverviewChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setProductOverview(event.target.value);

  const [frameworkQuery, setFrameworkQuery] = useState("");
  const filteredFrameworks =
    frameworkQuery === ""
      ? Object.values(Framework)
      : Object.values(Framework).filter((framework) =>
          framework.toLowerCase().includes(frameworkQuery)
        );

  const handleFrameworkQueryChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => setFrameworkQuery(event.target.value.toLowerCase());

  (window as any).a = Framework;
  (window as any).b = ProgrammingLanguage;
  (window as any).c = PROGRAMMING_LANGUAGE_BY_FRAMEWORK;

  const [programmingLanguageQuery, setProgrammingLanguageQuery] = useState("");
  const filteredProgrammingLanguages =
    store.framework != null
      ? programmingLanguageQuery === ""
        ? PROGRAMMING_LANGUAGE_BY_FRAMEWORK[store.framework]
        : PROGRAMMING_LANGUAGE_BY_FRAMEWORK[store.framework].filter(
            (programmingLanguage) =>
              programmingLanguage
                .toLowerCase()
                .includes(programmingLanguageQuery)
          )
      : [];

  const handleProgrammingLanguageQueryChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => setProgrammingLanguageQuery(event.target.value.toLowerCase());

  useEffect(() => setProgrammingLanguageQuery(""), [store.framework]);

  return (
    <div className="product-overview-section">
      <Combobox
        as="div"
        className="combo"
        value={store.framework}
        onChange={store.setFramework}
      >
        <Combobox.Label className="combo-label">Framework:</Combobox.Label>
        <Combobox.Input
          onChange={handleFrameworkQueryChange}
          className="combo-query"
        />
        <Combobox.Button className="combo-button">
          <FontAwesomeIcon icon={faChevronDown} />
        </Combobox.Button>
        <Combobox.Options className="combo-options">
          {frameworkQuery === "" ? (
            <Combobox.Option value={null} className="combo-option">
              -
            </Combobox.Option>
          ) : null}
          {filteredFrameworks.map((framework) => (
            <Combobox.Option
              key={framework}
              value={framework}
              className="combo-option"
            >
              {framework}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox>
      <Combobox
        as="div"
        className="combo"
        value={store.programmingLanguage}
        onChange={store.setProgrammingLanguage}
      >
        <Combobox.Label className="combo-label">
          Programming Language:
        </Combobox.Label>
        <Combobox.Input
          onChange={handleProgrammingLanguageQueryChange}
          className="combo-query"
        />
        <Combobox.Button className="combo-button">
          <FontAwesomeIcon icon={faChevronDown} />
        </Combobox.Button>
        <Combobox.Options className="combo-options">
          {programmingLanguageQuery === "" ? (
            <Combobox.Option value={null} className="combo-option">
              -
            </Combobox.Option>
          ) : null}
          {filteredProgrammingLanguages.map((programmingLanguage) => (
            <Combobox.Option
              key={programmingLanguage}
              value={programmingLanguage}
              className="combo-option"
            >
              {programmingLanguage}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox>

      <pre>
        <Textarea
          className="product-overview"
          value={store.productOverview || ""}
          onChange={handleProductOverviewChange}
        />
      </pre>
    </div>
  );
};

export default observer(ProductOverview);
