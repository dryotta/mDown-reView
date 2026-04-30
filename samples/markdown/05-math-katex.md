# 05 · Math (KaTeX)

Inline and display math, exercising the lazy `rehype-katex` chunk
(loaded only when `has-math-re.test.ts` matches `$…$` or `$$…$$`).

## Inline math

When $a \neq 0$, the equation $ax^2 + bx + c = 0$ has solutions
$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$, with discriminant
$\Delta = b^2 - 4ac$.

The Greek alphabet: $\alpha, \beta, \gamma, \delta, \epsilon, \zeta, \eta, \theta, \iota, \kappa, \lambda, \mu, \nu, \xi, \omicron, \pi, \rho, \sigma, \tau, \upsilon, \phi, \chi, \psi, \omega$.

## Display math — single equation

$$
e^{i\pi} + 1 = 0
$$

## Display math — fraction

$$
\frac{1}{2\pi} \int_{-\infty}^{\infty} e^{-x^2/2}\, dx = \frac{1}{\sqrt{2\pi}}
$$

## Display math — summation + integral

$$
\sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}
\qquad
\int_0^1 x^n\, dx = \frac{1}{n+1}, \quad n \in \mathbb{N}
$$

## Matrix

$$
A = \begin{pmatrix}
  a_{11} & a_{12} & a_{13} \\
  a_{21} & a_{22} & a_{23} \\
  a_{31} & a_{32} & a_{33}
\end{pmatrix}
\qquad
\det(A) = \sum_{\sigma \in S_n} \operatorname{sgn}(\sigma) \prod_{i=1}^{n} a_{i,\sigma(i)}
$$

## Aligned

$$
\begin{aligned}
  (a + b)^2 &= a^2 + 2ab + b^2 \\
  (a - b)^2 &= a^2 - 2ab + b^2 \\
  a^2 - b^2 &= (a + b)(a - b) \\
  a^3 + b^3 &= (a + b)(a^2 - ab + b^2)
\end{aligned}
$$

## Cases

$$
|x| = \begin{cases}
  x  & \text{if } x \geq 0 \\
  -x & \text{if } x < 0
\end{cases}
$$

## Common physics formulas

- Schrödinger equation: $i\hbar \frac{\partial}{\partial t} \psi(\mathbf{r}, t) = \hat{H}\,\psi(\mathbf{r}, t)$
- Maxwell (in vacuum): $\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}, \quad \nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}$
- Mass–energy equivalence: $E = mc^2$
- Stefan–Boltzmann: $P = \sigma A T^4$

## Engineering — Big-O

For an algorithm with running time $T(n) = O(n \log n)$ and space $S(n) = O(n)$,
the constant factor for sort comparisons is roughly $c \approx 1.39$ for
balanced merge-sort, giving $T(n) \approx 1.39\, n \log_2 n$ comparisons.

## Trailing checklist

- [ ] Display equations render in their own block (not inline).
- [ ] Matrix layout has correct row spacing.
- [ ] `\begin{aligned}` aligns at `&`.
- [ ] No `unsafe-inline` style breakage — Shiki, KaTeX, and Mermaid all coexist (rule 17a in `docs/security.md`).
- [ ] No console errors when this page first renders (KaTeX chunk loads lazily).
