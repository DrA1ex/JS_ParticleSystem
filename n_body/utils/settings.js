export async function loadState() {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const queryParams = Object.fromEntries(urlSearchParams.entries());

    if (queryParams.state) {
        try {
            const data = await fetch(queryParams.state);
            if (data.ok) {
                return await data.json();
            }

            console.error(`Download failed. Code ${data.status}: ${data.statusText}`);
        } catch (e) {
            console.error("Unable to load state", e);
        }
    }

    return null;
}