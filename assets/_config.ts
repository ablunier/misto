import lume from "lume/mod.ts";

const site = lume({
  // The public address of the migrated site; used by sitemap, feed and metas.
  location: new URL("https://example.com"),
});

// scripts/download.ts puts every downloaded file under assets/.
// add() lets plugins process the files (minify CSS, transform images);
// use site.copy("assets") instead to ship them byte for byte.
site.add("assets");

// Plugins the user chose go here, e.g.:
// import sitemap from "lume/plugins/sitemap.ts";
// site.use(sitemap());

export default site;
