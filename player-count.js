
function updatePlayerCount(number_of_players) {
    document.getElementById("player-count").innerText = number_of_players;
}

async function FetchPlayerCount() {
    let playerCount;
    await fetch('http://164.132.207.52:30120/dynamic.json')
        .then(function (response) {
            return response.json();
        })
        .then(function (data) {
            playerCount = data.clients;
            updatePlayerCount(data.clients);
        })
        .catch(function (err) {
            console.log(err);
        });
    
}

window.addEventListener("DOMContentLoaded", async () => {
    await FetchPlayerCount();
})

function resizeIframe(obj) {
    obj.style.height = obj.contentWindow.document.documentElement.scrollHeight + 'px';
}
