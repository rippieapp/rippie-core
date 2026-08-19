# commit conventions

## message format

a commit message consists of 3 sections: a header, a body and a footer.
the header is mandatory, the body and footer are optional.

the header has the following format:

```text
<scope>: <subject>
```

- the scope is a noun describing a section of the codebase
    - examples: `commands`, `core`, `events`, `config`, `docs`, `chore`, `ci`
- the subject is a short description of the change that
    - should not exceed 50 characters
    - should be in the imperative mood
    - should start with a lowercase letter and end with a lowercase letter or a number
- lines separating message sections (if present) should be empty
- the body (if present) contains a more detailed description of the change
    - each line should not exceed 72 characters
- the header can optionally contain multiple messages separated by `; `

## examples

```text
core: integrate spotify track resolver
commands: add about command; docs: update readme
events: fix interactions failing on error
chore: setup husky to automate pre-commit hooks
```
