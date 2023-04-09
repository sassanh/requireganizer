import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Combobox } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import Textarea from "react-textarea-autosize";
import { Framework, ProgrammingLanguage, useStore } from "store";

const ProductOverview: React.FunctionComponent = () => {
  const store = useStore();

  const handleProductOverviewChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setProductOverview(event.target.value);

  const [frameworkQuery, setFrameworkQuery] = useState("");
  const filteredFrameworks =
    frameworkQuery === ""
      ? Object.keys(Framework)
      : Object.keys(Framework).filter((framework) =>
          framework.toLowerCase().includes(frameworkQuery)
        );

  const handleFrameworkQueryChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => setFrameworkQuery(event.target.value);

  const [programmingLanguageQuery, setProgrammingLanguageQuery] = useState("");
  const filteredProgrammingLanguages =
    programmingLanguageQuery === ""
      ? Object.keys(ProgrammingLanguage)
      : Object.keys(ProgrammingLanguage).filter((programmingLanguage) =>
          programmingLanguage.toLowerCase().includes(programmingLanguageQuery)
        );

  const handleProgrammingLanguageQueryChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => setProgrammingLanguageQuery(event.target.value);

  return (
    <>
      <Combobox value={store.framework} onChange={store.setFramework}>
        <Combobox.Input onChange={handleFrameworkQueryChange} />
        <FontAwesomeIcon icon={faChevronDown} />
        <Combobox.Options>
          <Combobox.Option value={null}> --- </Combobox.Option>
          {filteredFrameworks.map((framework) => (
            <Combobox.Option
              key={Framework[framework as keyof typeof Framework]}
              value={Framework[framework as keyof typeof Framework]}
            >
              {framework}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox>

      <Combobox
        value={store.programmingLanguage}
        onChange={store.setProgrammingLanguage}
      >
        <Combobox.Input onChange={handleProgrammingLanguageQueryChange} />
        <FontAwesomeIcon icon={faChevronDown} />
        <Combobox.Options>
          <Combobox.Option value={null}> --- </Combobox.Option>
          {filteredProgrammingLanguages.map((programmingLanguage) => (
            <Combobox.Option
              key={
                ProgrammingLanguage[
                  programmingLanguage as keyof typeof ProgrammingLanguage
                ]
              }
              value={
                ProgrammingLanguage[
                  programmingLanguage as keyof typeof ProgrammingLanguage
                ]
              }
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
    </>
  );
};

export default observer(ProductOverview);
