const img = document.getElementById("clickable-image");
let clickCount = 0;
let imageIndex = 0;

const newImages = [
  "/img/testCharA_blanka.png",
  "/img/testCharA_bow.png",
  "/img/testCharA_hello.png",
];

img.addEventListener("click", () => {
  clickCount++;

  if (clickCount % 5 === 0) {
    const randomIndex = Math.floor(Math.random() * newImages.length);
    img.src = newImages[randomIndex];
  }
});