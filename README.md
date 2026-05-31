# Idle Obelisk Divine Relic Calculator

A lightweight browser calculator for estimating divine relic reroll odds and gem cost.

## Features

- **Option 1 (target -> cost):** Enter desired divine target and estimate chance, expected rerolls, and expected gem cost.
- **Option 2 (budget/risk -> target):** Enter gem budget and desired success chance, then solve for the highest target that meets that risk level.
- Built-in probability methods (exact binomial when feasible, with approximations for large values).
- Clear distribution and standard-deviation reference panels.

## Usage

Open `index.html` in a browser.

No install or dependencies required.

## Publish on GitHub Pages

1. Create a new GitHub repository.
2. Upload/push these files.
3. In the repo settings, open **Pages**.
4. Set source to **Deploy from a branch**.
5. Select branch `main` and folder `/ (root)`.
6. Save and wait for deployment.
7. Share the generated Pages URL.

## Notes

- One reroll costs **200 gems**.
- Divine chance per relic is **1 / 25,000**.
- Option 2 solves to an integer target, so achieved success probability may be slightly above the requested chance.

