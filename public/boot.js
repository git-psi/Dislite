// Couleurs du thème enregistrées au dernier lancement (voir applyTheme), appliquées
// avant le premier rendu : le splash statique a d'emblée les bonnes couleurs.
try {
  var boot = JSON.parse(localStorage.getItem("accord:boot") || "null");
  if (boot) for (var k in boot) document.documentElement.style.setProperty(k, boot[k]);
  // Session connue : l'interface s'ouvrira directement, on en montre la forme.
  if (localStorage.getItem("accord:active") || localStorage.getItem("accord:snapshot")) document.documentElement.dataset.boot = "shell";
} catch (e) {}
