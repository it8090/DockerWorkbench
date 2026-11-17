const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  search: "m21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  stack: "m12 3 9 5-9 5-9-5 9-5M3 12l9 5 9-5M3 16l9 5 9-5",
  container: "m12 3 9 5v9l-9 5-9-5V8l9-5M3 8l9 5 9-5M12 13v9",
  host: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M17 7h1M17 17h1",
  refresh: "M20 11a8 8 0 1 0-2.34 6.66M20 4v7h-7",
  collapse: "m8 3 4 4 4-4M12 7V2m-4 19 4-4 4 4M12 17v5M4 12h16",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 3-2 3 2 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 2-3-2-3 3-3 3-1 1-3",
  import: "M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6",
  theme: "M20.5 13A8.5 8.5 0 0 1 11 3.5a8.5 8.5 0 1 0 9.5 9.5",
  history: "M3 4v5h5M3.7 8A9 9 0 1 1 3 14M12 7v5l3 2",
  play: "m7 4 13 8-13 8V4",
  stop: "M5 5h14v14H5z",
  down: "M5 4v12m-4-4 4 4 4-4M19 20V8m-4 4 4-4 4 4",
  layers: "M4 3h12v14H4zM8 21h12V7",
  image: "M3 3h18v18H3zM3 16l5-5 4 4 4-6 5 8M7 7h.01",
  network: "M9 3h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 9v3M5 16v-4h14v4",
  volume:
    "M20 6c0 2-4 4-8 4S4 8 4 6s4-4 8-4 8 2 8 4M4 6v12c0 2 4 4 8 4s8-2 8-4V6M4 12c0 2 4 4 8 4s8-2 8-4",
  maximize: "M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m9 5 7 7-7 7",
  pause: "M7 4h3v16H7zM15 4h3v16h-3z",
  wrap: "M3 5h18M3 11h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 17h4",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  clear: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  copy: "M9 8h11v13H9zM15 8V3H4v13h5",
  check: "m5 12 4 4L19 6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  terminal: "m4 6 6 6-6 6m9 0h7",
  lock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg className={`icon icon-${name}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || paths.container} />
    </svg>
  );
}
