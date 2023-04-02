import React, { useState } from "react";

interface DescriptionInputProps {
  onSubmit: null | ((description: string) => void);
}

const DescriptionInput: React.FunctionComponent<DescriptionInputProps> = ({
  onSubmit,
}) => {
  const [description, setDescription] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(description);
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="description">Software Description:</label>
      <textarea
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ minWidth: "400px", minHeight: "100px" }}
      />
      <button type="submit" disabled={onSubmit == null}>
        Submit
      </button>
    </form>
  );
};

export default DescriptionInput;
