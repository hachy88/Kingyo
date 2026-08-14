// client.js の完成版

document.addEventListener('DOMContentLoaded', () => {
    // HTML要素を取得
    const touchArea = document.getElementById('touch-area');
    const statusElement = document.getElementById('status');

    // サーバーのURL（動的に取得）
    const WEBSOCKET_URL = `ws://${window.location.hostname}:8080`;
    let socket;

    // ★★★ ここからが修正・追加した部分 ★★★
    function connectWebSocket() {
        console.log('Attempting to connect to WebSocket server...');
        statusElement.textContent = 'Connecting to server...'; // ステータスを更新
        statusElement.style.color = '#ffcc00'; // 文字色を黄色に

        // WebSocketオブジェクトを生成して接続を開始
        socket = new WebSocket(WEBSOCKET_URL);

        // 接続が確立したときの処理
socket.onopen = () => {
    console.log('WebSocket connection established.');
    
    // 表示するテキストを<br>で区切る
    const message = 'Tap randomly here, something is born, something begins.<br><br>' +
                    'ここに触れれば，何かが生まれ，何かが始まる．<br>';
                    
    // innerHTMLを使ってHTMLとしてテキストをセット
    statusElement.innerHTML = message; // 修正点１：innerHTMLを使用
    
    statusElement.style.color = '#4caf50'; // 文字色を緑色に
    statusElement.style.textAlign = 'center'; // 修正点２：テキストを中央揃えに
    statusElement.style.position = 'relative'; // 1. 位置の基準を元の場所にする
    statusElement.style.bottom = '100px';       // 2. 元の場所から20px上に移動
};

        // 接続が切断されたときの処理
        socket.onclose = () => {
            console.log('WebSocket connection closed. Retrying in 3 seconds...');
            statusElement.textContent = 'Connection lost. Retrying...'; // ステータスを更新
            statusElement.style.color = '#f44336'; // 文字色を赤色に
            
            // 3秒後に再接続を試みる
            setTimeout(connectWebSocket, 3000);
        };

        // エラーが発生したときの処理
        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            statusElement.textContent = 'Connection error.'; // ステータスを更新
            statusElement.style.color = '#f44336'; // 文字色を赤色に
        };
    }
    // ★★★ ここまでが修正・追加した部分 ★★★

    function handleInteraction(event) {
        // clientX/Yはビューポートの座標なので、ページ全体の座標であるpageX/Yが適している場合が多いです
        const x = event.pageX;
        const y = event.pageY;

        // 画面サイズで正規化して送信（ラップトップ側で正しくスケールさせるため）
        const nx = x / window.innerWidth;
        const ny = y / window.innerHeight;

        // WebSocketで座標をサーバーに送信
        if (socket && socket.readyState === WebSocket.OPEN) {
            const data = JSON.stringify({ type: 'tap', x: nx, y: ny, isNormalized: true });
            socket.send(data);
            console.log('Sent coordinate to server:', data);
        }
    }
    
    // イベントリスナーを設定
    touchArea.addEventListener('pointerdown', handleInteraction);
    
    // 最初の接続を開始
    connectWebSocket();
});