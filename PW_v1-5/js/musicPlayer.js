function goodLuck()
{
    console.log("٩( ᐛ )و");
}

const musicContainer = document.querySelector('.music-container');
const playBtn = document.querySelector('#play');
const prevBtn = document.querySelector('#prev');
const nextBtn = document.querySelector('#next');
const audio = document.querySelector('#audio');
const progress = document.querySelector('.progress-bar');
const progressContainer = document.querySelector('.progress-container');
const sound = document.querySelector('.sound-bar');
const soundContainer = document.querySelector('.sound-container');
const title = document.querySelector('#title');
const cover = document.querySelector('#music-cover');

// Song titles
const songs = ['1week', 'beMy', 'merryGoRound', '3657', 'weAre'];

// Keep track of songs
let songIndex = Math.floor(Math.random()*5);

// Load Song info
loadSong(songs[songIndex]);

// Update song details
function loadSong(song)
{
    title.innerText = song;
    audio.src = `playground/music_nator/music/${song}.mp3`;
    cover.src = `playground/music_nator/img/${song}.png`;
}

function playSong()
{
    musicContainer.classList.add('play');
    playBtn.querySelector('i.fa').classList.remove('fa-play');
    playBtn.querySelector('i.fa').classList.add('fa-pause');
    audio.volume = 0.2;
    audio.play();
}

function pauseSong()
{
    musicContainer.classList.remove('play');
    playBtn.querySelector('i.fa').classList.add('fa-play');
    playBtn.querySelector('i.fa').classList.remove('fa-pause');

    audio.pause();
}

function prevSong()
{
    songIndex--;

    if(songIndex < 0)
    {
        songIndex = songs.length - 1;
    }

    loadSong(songs[songIndex]);

    playSong();
}

function nextSong()
{
    songIndex++;

    if(songIndex > songs.length-1)
    {
        songIndex = 0;
    }

    loadSong(songs[songIndex]);

    playSong();
}

function updateProgress(e)
{
    const {duration, currentTime} = e.srcElement;
    const progressPercent = (currentTime / duration) * 100;
    progress.style.width = `${progressPercent}%`
}

function setProgress(e)
{
    const width = this.clientWidth;
    const clickX = e.offsetX;
    const duration = audio.duration;

    audio.currentTime = (clickX / width) * duration;
}

function updateSoundProgress(e)
{
    // console.log(e.srcElement);
    const {duration, currentTime} = e.srcElement;
    // const progressPercent = (currentTime / duration) * 100;
    // sound.style.width = `${progressPercent}%`
    const progressPercent = 0;
    sound.style.width = `${progressPercent}%`;
}

function setSoundProgress(e)
{
    const width = this.clientWidth;
    const clickX = e.offsetX;
    const audioVolume = clickX / width;
    const progressPercent = audioVolume * 100;
    sound.style.width = `${progressPercent}%`;
    // console.log(audioVolume*100);
    if(clickX < 5)
    {
        console.log("mute");
        audio.volume = 0;
    }
    else
    {
        audio.volume = audioVolume;
    }
}

// Event Listeners
playBtn.addEventListener('click', () =>{
    const isPlaying = musicContainer.classList.contains('play');

    if(isPlaying)
    {
        pauseSong();
    }
    else
    {
        playSong();
    }
});

// Change Song Events
goodLuck();
prevBtn.addEventListener('click', prevSong);
nextBtn.addEventListener('click', nextSong);

audio.addEventListener('timeupdate', updateProgress);

progressContainer.addEventListener('click', setProgress);
soundContainer.addEventListener('click', setSoundProgress);

audio.addEventListener('ended', nextSong);
