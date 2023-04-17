const menuToggle = document.querySelector('.toggle');
const wrapper = document.querySelector('.wrapper');
const showCase = document.querySelector('.showcase');
const header = document.querySelector('#header');


menuToggle.addEventListener('click', () =>
{
    menuToggle.classList.toggle('active');
    wrapper.classList.toggle('active');
    showCase.classList.toggle('active');
    header.classList.toggle('active');
});

