<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$backend = 'http://localhost:3001';
$path = '';
if (isset($_SERVER['PATH_INFO'])) { $path = $_SERVER['PATH_INFO']; }
elseif (isset($_SERVER['ORIG_PATH_INFO'])) { $path = $_SERVER['ORIG_PATH_INFO']; }
if ($path === '' || $path === '/') { $path = '/'; }
$url = $backend . $path;
if (!empty($_SERVER['QUERY_STRING'])) { $url .= '?' . $_SERVER['QUERY_STRING']; }

$method = $_SERVER['REQUEST_METHOD'];
$body = null;
if ($method === 'POST' || $method === 'PUT') { $body = file_get_contents('php://input'); }

$opts = ['http' => ['method' => $method, 'header' => "Content-Type: application/json", 'content' => $body, 'timeout' => 15, 'ignore_errors' => true]];
$context = stream_context_create($opts);
$response = @file_get_contents($url, false, $context);

if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'backend_unreachable', 'hint' => 'Is battleship-new-server running on port 3001?']);
    exit;
}
if (isset($http_response_header[0]) && preg_match('/(\d{3})/', $http_response_header[0], $m)) { http_response_code((int)$m[1]); }
header('Content-Type: application/json');
echo $response;
?>