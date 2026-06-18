Copy your assets from the old folder into this directory so URLs match the HTML port:

  office-scene.html   → logic goes in src/ (not here)
  *.gltf, *.jpg, *.png, *.mp4  → keep the same filenames as in the original HTML

In React/Vite, load them with paths like:

  `${import.meta.env.BASE_URL}office-scene-optimized/office-table-embed65.gltf`

Do not commit multi‑GB binaries unless you use Git LFS or a separate asset host.
