/* Guards against a double tap opening the same page twice: while a push is
   still animating in, further pushes are ignored. The window comfortably
   covers the slide-in, after which normal navigation resumes. */
let locked = false;

export function pushOnce(router, href) {
  if (locked) return;
  locked = true;
  router.push(href);
  setTimeout(() => { locked = false; }, 700);
}
