# BLACKHOLE UI design contracts

The authoritative design contract for the Jarvis face is [runtime/public/DESIGN.md](runtime/public/DESIGN.md). Its scope is `/jarvis` only; the owner cockpit and Android app have separate UI histories. The scoped contract lives beside the HTML, CSS, and canvas renderer so changes to that surface can be reviewed together. It is not served by the runtime static allowlist.
