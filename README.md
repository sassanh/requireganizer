# Requireganizer

Requireganizer is a software application designed to facilitate an iterative software development process. It automates the generation of necessary documentation and code with the help of ChatGPT, a large language model trained by OpenAI.

<img width="1055" alt="image" src="https://github.com/sassanh/requireganizer/assets/1270688/89a9873c-7b80-4ab0-a647-c2f246f42401">

## Status

:warning: Requireganizer is currently under active development. Some features may not be fully implemented yet, or they may change in future updates. Please keep this in mind when using the application.

## Key Features

- **Iterative Documentation Generation:** Converts a human-written software description into a formal product overview, generates user stories, requirements, acceptance criteria, test scenarios, and test cases.

- **Automated Code Generation:** Using the generated test scenarios, the application creates test code and generates the code required to satisfy those tests.

- **Retrospective Analysis:** Assists in running retrospectives to understand user concerns and facilitate updates in the specification for the next major iteration.

- **Consistency Check:** Throughout each iteration, Requireganizer utilizes ChatGPT to identify and highlight any inconsistencies in the generated material for user attention and potential correction.

## Configuration

This project uses environment variables for configuration.

We provide an `.env.example` file in the repository as a template for all the environment variables used in the project. To use it, copy it to a new file named `.env.local`:

```bash
cp .env.example .env.local
```

Then, open .env.local and fill in your actual values.

_Note: .env.local is listed in .gitignore and will not be checked into the git repository._

## Usage

Run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application running.

To use the application, provide a detailed description of the desired software. The application guides users through multiple minor iterations, resulting in a major iteration of the software development process. Each major iteration includes the generation of a formal description, user stories, requirements, acceptance criteria, test scenarios and cases, test code, and application code.

## Contribution

We welcome contributions to Requireganizer. Please read our [contributing guidelines](/CONTRIBUTING.md) before submitting a Pull Request.

## License

This project is licensed under the MIT License. See the [LICENSE](/LICENSE) file for details.

## Contact

If you have any questions or want to discuss something about the project, feel free to open an issue.
