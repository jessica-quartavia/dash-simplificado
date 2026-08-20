/**
 * Botão discreto para voltar ao topo com scroll suave.
 */

const SHOW_AFTER_PX = 320;

export function bootScrollToTop() {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById("scroll-top-btn")) return () => {};

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "scroll-top-btn";
  btn.className = "scroll-top-btn";
  btn.hidden = true;
  btn.setAttribute("aria-label", "Voltar ao topo");
  btn.innerHTML = `
    <span class="scroll-top-icon" aria-hidden="true">↑</span>
    <span class="scroll-top-label">Topo</span>`;
  document.body.appendChild(btn);

  const sync = () => {
    const visible = window.scrollY >= SHOW_AFTER_PX;
    btn.hidden = !visible;
    btn.classList.toggle("is-visible", visible);
  };

  const onClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  btn.addEventListener("click", onClick);
  window.addEventListener("scroll", sync, { passive: true });
  sync();

  return () => {
    btn.removeEventListener("click", onClick);
    window.removeEventListener("scroll", sync);
    btn.remove();
  };
}
