//! Language of backend messages (errors, status texts) – set by the UI via `app_set_language`.
use std::sync::atomic::{AtomicU8, Ordering};

const LANG_PL: u8 = 0;
const LANG_EN: u8 = 1;
const LANG_MS: u8 = 2;

static LANG: AtomicU8 = AtomicU8::new(LANG_PL);

pub fn is_en() -> bool {
    LANG.load(Ordering::Relaxed) != LANG_PL
}

pub fn is_ms() -> bool {
    LANG.load(Ordering::Relaxed) == LANG_MS
}

fn parse_lang_code(lang: &str) -> u8 {
    let code = lang.trim().to_ascii_lowercase();
    if code.starts_with("ms") {
        LANG_MS
    } else if code.starts_with("en") {
        LANG_EN
    } else {
        LANG_PL
    }
}

fn is_english_code(lang: &str) -> bool {
    parse_lang_code(lang) == LANG_EN
}

fn is_malay_code(lang: &str) -> bool {
    parse_lang_code(lang) == LANG_MS
}

pub fn set_language(lang: &str) {
    LANG.store(parse_lang_code(lang), Ordering::Relaxed);
}

pub fn ms_lookup(en: &'static str) -> &'static str {
    match en {
        "\n• {} – server: {}; RemoteFlow: {}" => "\n• {} – pelayan: {}; RemoteFlow: {}",
        "\r\n\u001b[1;31m[RemoteFlow SSH error]\u001b[0m {}\r\n" => "\r\n\u001b[1;31m[Ralat SSH RemoteFlow]\u001b[0m {}\r\n",
        "\r\n\u001b[33m[The SSH session was closed by the remote server]\u001b[0m\r\n" => "\r\n\u001b[33m[Sesi SSH telah ditutup oleh pelayan jauh]\u001b[0m\r\n",
        "   Debian/Ubuntu: sudo apt install freerdp3-x11 (or freerdp2-x11)" => "   Debian/Ubuntu: sudo apt install freerdp3-x11 (atau freerdp2-x11)",
        "'{}' already exists" => "'{}' sudah wujud",
        "'{}' is not a file" => "'{}' bukan sebuah fail",
        "--title=Choose a folder to upload" => "--title=Pilih folder untuk dimuat naik",
        "A selected group no longer exists. Select the export scope again." => "Kumpulan yang dipilih tidak lagi wujud. Pilih skop eksport sekali lagi.",
        "A valid OpenSSH certificate is required" => "Sijil OpenSSH yang sah diperlukan",
        "An unencrypted export stores all passwords and keys in plain text – explicit confirmation is required" => "Eksport tanpa penyulitan menyimpan semua kata laluan dan kunci dalam teks biasa – pengesahan jelas diperlukan",
        "Base64 decoding error: {}" => "Ralat penyahkodan Base64: {}",
        "Binary file content expected" => "Kandungan fail perduaan dijangkakan",
        "Broken link: {}" => "Pautan rosak: {}",
        "Cannot connect to RDP server {}: {}" => "Tidak dapat menyambung ke pelayan RDP {}: {}",
        "Cannot create folder {:?}: {}" => "Tidak dapat mencipta folder {:?}: {}",
        "Cannot create folder {}: {}" => "Tidak dapat mencipta folder {}: {}",
        "Cannot create remote folder {}" => "Tidak dapat mencipta folder jauh {}",
        "Cannot create the backup folder {:?}: {}" => "Tidak dapat mencipta folder sandaran {:?}: {}",
        "Cannot create the backup folder: {}" => "Tidak dapat mencipta folder sandaran: {}",
        "Cannot create the temporary folder: {}" => "Tidak dapat mencipta folder sementara: {}",
        "Cannot move '{}' to the trash: {}" => "Tidak dapat mengalihkan '{}' ke tong sampah: {}",
        "Cannot open '{}': {}" => "Tidak dapat membuka '{}': {}",
        "Cannot open the clipboard: {:?}" => "Tidak dapat membuka papan keratan: {:?}",
        "Cannot open {}: {}" => "Tidak dapat membuka {}: {}",
        "Cannot prepare the SSH certificate: {}" => "Tidak dapat menyediakan sijil SSH: {}",
        "Cannot put the file list on the clipboard: {:?}" => "Tidak dapat meletakkan senarai fail ke papan keratan: {:?}",
        "Cannot read '{}': {}" => "Tidak dapat membaca '{}': {}",
        "Cannot read backup {:?}: {}" => "Tidak dapat membaca sandaran {:?}: {}",
        "Cannot read the OpenSSH private key: {}" => "Tidak dapat membaca kunci peribadi OpenSSH: {}",
        "Cannot read the SSH certificate from '{}' – check that the file exists and is an OpenSSH certificate (…-cert.pub)." => "Tidak dapat membaca sijil SSH daripada '{}' – pastikan fail tersebut wujud dan merupakan sijil OpenSSH (…-cert.pub).",
        "Cannot read {}: {}" => "Tidak dapat membaca {}: {}",
        "Cannot read: {}" => "Tidak dapat membaca: {}",
        "Cannot save the display settings: {}" => "Tidak dapat menyimpan tetapan paparan: {}",
        "Cannot save the new version in the program folder ({}). Download it from the releases page and replace the file manually." => "Tidak dapat menyimpan versi baharu dalam folder atur cara ({}). Muat turun daripada halaman keluaran dan gantikan fail secara manual.",
        "Cannot use the RSA key: {}" => "Tidak dapat menggunakan kunci RSA: {}",
        "Certificate verification error: {}" => "Ralat pengesahan sijil: {}",
        "Choose a folder to upload" => "Pilih folder untuk dimuat naik",
        "Choose the SSH certificate file" => "Pilih fail sijil SSH",
        "Choose the SSH private key file" => "Pilih fail kunci peribadi SSH",
        "Ciphertext decoding error: {}" => "Ralat penyahkodan teks sifir: {}",
        "Clipboard staging folder missing: {}" => "Folder persediaan papan keratan tiada: {}",
        "Connecting..." => "Menyambung...",
        "Connection not found" => "Sambungan tidak dijumpai",
        "Connection with ID '{}' not found" => "Sambungan dengan ID '{}' tidak dijumpai",
        "Could not back up the vault before converting it to format v3 ({}). Free disk space or check the permissions of the backup folder." => "Tidak dapat membuat sandaran peti besi sebelum menukarnya kepada format v3 ({}). Kosongkan ruang cakera atau semak kebenaran folder sandaran.",
        "Could not back up the vault before converting it to format v3 ({}). The vault was unlocked in its current format; saving changes requires a successful backup – free disk space or check the permissions of the backup folder." => "Tidak dapat membuat sandaran peti besi sebelum menukarnya kepada format v3 ({}). Peti besi dibuka dalam format semasanya; menyimpan perubahan memerlukan sandaran yang berjaya – kosongkan ruang cakera atau semak kebenaran folder sandaran.",
        "Could not back up the vault: {}" => "Tidak dapat membuat sandaran peti besi: {}",
        "Could not connect to host '{}': no response (check the IP address and port)" => "Tidak dapat menyambung ke hos '{}': tiada respons (semak alamat IP dan port)",
        "Could not decrypt credential '{}': {}" => "Tidak dapat menyahsulit kelayakan '{}': {}",
        "Could not decrypt the data of connection '{}': {}" => "Tidak dapat menyahsulit data sambungan '{}': {}",
        "Could not open local port {}: {}" => "Tidak dapat membuka port tempatan {}: {}",
        "Could not read the terminal directory: {}" => "Tidak dapat membaca direktori terminal: {}",
        "Could not start the local RDP proxy: {}" => "Tidak dapat memulakan proksi RDP tempatan: {}",
        "Credential not found" => "Kelayakan tidak dijumpai",
        "Decryption failed (wrong password or corrupted data)" => "Penyahsulitan gagal (kata laluan salah atau data rosak)",
        "Embedded FreeRDP requires X11 – restart RemoteFlow after enabling the option in Settings." => "FreeRDP terbenam memerlukan X11 – mulakan semula RemoteFlow selepas mendayakan pilihan tersebut dalam Tetapan.",
        "Enter a non-empty password" => "Masukkan kata laluan yang tidak kosong",
        "Error binding the local RDP proxy: {}" => "Ralat mengikat proksi RDP tempatan: {}",
        "Error building the RDCleanPath response: {}" => "Ralat membina respons RDCleanPath: {}",
        "Error creating file '{}': {}" => "Ralat mencipta fail '{}': {}",
        "Error creating file {}: {}" => "Ralat mencipta fail {}: {}",
        "Error creating folder '{}': {}" => "Ralat mencipta folder '{}': {}",
        "Error creating remote file {}: {}" => "Ralat mencipta fail jauh {}: {}",
        "Error deleting '{}': {}" => "Ralat memadam '{}': {}",
        "Error deleting folder '{}': {}" => "Ralat memadam folder '{}': {}",
        "Error downloading {}: {}" => "Ralat memuat turun {}: {}",
        "Error opening '{}': {}" => "Ralat membuka '{}': {}",
        "Error opening the SFTP subsystem: {}" => "Ralat membuka subsistem SFTP: {}",
        "Error opening the SSH channel: {}" => "Ralat membuka saluran SSH: {}",
        "Error opening {}: {}" => "Ralat membuka {}: {}",
        "Error parsing the decrypted data: {}" => "Ralat menghurai data yang dinyahsulit: {}",
        "Error reading '{}': {}" => "Ralat membaca '{}': {}",
        "Error reading file '{}': {}" => "Ralat membaca fail '{}': {}",
        "Error reading file {:?}: {}" => "Ralat membaca fail {:?}: {}",
        "Error reading folder '{}': {}" => "Ralat membaca folder '{}': {}",
        "Error reading folder {}: {}" => "Ralat membaca folder {}: {}",
        "Error reading local folder '{}': {}" => "Ralat membaca folder tempatan '{}': {}",
        "Error reading remote folder {}: {}" => "Ralat membaca folder jauh {}: {}",
        "Error saving '{}': {}" => "Ralat menyimpan '{}': {}",
        "Error saving file {}: {}" => "Ralat menyimpan fail {}: {}",
        "Error saving remote file {}: {}" => "Ralat menyimpan fail jauh {}: {}",
        "Error sending X.224 to the RDP server: {}" => "Ralat menghantar X.224 ke pelayan RDP: {}",
        "Error starting the local RDP proxy: {}" => "Ralat memulakan proksi RDP tempatan: {}",
        "Error starting the shell: {}" => "Ralat memulakan shell: {}",
        "Error uploading {}: {}" => "Ralat memuat naik {}: {}",
        "Error writing file {:?}: {}" => "Ralat menulis fail {:?}: {}",
        "Error writing the file to the exchange folder: {}" => "Ralat menulis fail ke folder pertukaran: {}",
        "Export data serialisation error: {}" => "Ralat pensirilan data eksport: {}",
        "Export file serialisation error: {}" => "Ralat pensirilan fail eksport: {}",
        "File decoding error: {}" => "Ralat penyahkodan fail: {}",
        "File missing in the temporary folder: {}" => "Fail tiada dalam folder sementara: {}",
        "Import file parse error: {}" => "Ralat menghurai fail import: {}",
        "Invalid Master Password" => "Kata Laluan Utama tidak sah",
        "Invalid Master Password (token verification failed)" => "Kata Laluan Utama tidak sah (pengesahan token gagal)",
        "Invalid RDP certificate SHA-256 fingerprint stored in the vault" => "Cap jari SHA-256 sijil RDP yang disimpan dalam peti besi tidak sah",
        "Invalid RDP client request (RDCleanPath): {}" => "Permintaan klien RDP tidak sah (RDCleanPath): {}",
        "Invalid SSH certificate: {}" => "Sijil SSH tidak sah: {}",
        "Invalid TPKT header (0x{:02x} != 0x03)" => "Pengepala TPKT tidak sah (0x{:02x} != 0x03)",
        "Invalid TPKT length: {}" => "Panjang TPKT tidak sah: {}",
        "Invalid backup file name" => "Nama fail sandaran tidak sah",
        "Invalid ciphertext format" => "Format teks sifir tidak sah",
        "Invalid clipboard staging folder: {}" => "Folder persediaan papan keratan tidak sah: {}",
        "Invalid file name" => "Nama fail tidak sah",
        "Invalid file name encoding" => "Pengekodan nama fail tidak sah",
        "Invalid header {}" => "Pengepala tidak sah {}",
        "Invalid nonce length" => "Panjang nonce tidak sah",
        "Invalid path: {}" => "Laluan tidak sah: {}",
        "Keys in the PuTTY format (.ppk) are not supported. Export the key in PuTTYgen: Conversions → Export OpenSSH key (new format) and paste the result." => "Kunci dalam format PuTTY (.ppk) tidak disokong. Eksport kunci dalam PuTTYgen: Conversions → Export OpenSSH key (new format) dan tampal hasilnya.",
        "Local port {} is already used by a tunnel in the tab \"{}\". Close that tab or change the local port in the tunnel settings." => "Port tempatan {} sudah digunakan oleh terowong dalam tab \"{}\". Tutup tab tersebut atau tukar port tempatan dalam tetapan terowong.",
        "Local port {} is used by another program on this computer. Change the local port in the tunnel settings or close the program that uses it (find it with: {})." => "Port tempatan {} digunakan oleh atur cara lain pada komputer ini. Tukar port tempatan dalam tetapan terowong atau tutup atur cara yang menggunakannya (cari dengan: {}).",
        "Local tunnel (-L): \u001b[36m127.0.0.1:{}\u001b[0m → \u001b[36m{}:{}\u001b[0m (via the server)" => "Terowong tempatan (-L): \u001b[36m127.0.0.1:{}\u001b[0m → \u001b[36m{}:{}\u001b[0m (melalui pelayan)",
        "Login failed for user '{}' on server {}. Check the password or key." => "Log masuk gagal untuk pengguna '{}' pada pelayan {}. Semak kata laluan atau kunci.",
        "Login timed out ({} s) – the server or key handling does not respond." => "Log masuk tamat masa ({} s) – pelayan atau pengendalian kunci tidak memberi respons.",
        "Missing header {}" => "Pengepala tiada {}",
        "Nesting too deep: {}" => "Aras sarang terlalu dalam: {}",
        "No files to put on the clipboard" => "Tiada fail untuk diletakkan pada papan keratan",
        "No home folder" => "Tiada folder rumah",
        "No newer portable version." => "Tiada versi mudah alih yang lebih baharu.",
        "No target folder" => "Tiada folder sasaran",
        "No vault file to back up" => "Tiada fail peti besi untuk disandarkan",
        "Nonce decoding error: {}" => "Ralat penyahkodan nonce: {}",
        "Not a folder: {}" => "Bukan sebuah folder: {}",
        "Not an RDP connection" => "Bukan sambungan RDP",
        "PIN lock is not active – the Master Password is required" => "Kunci PIN tidak aktif – Kata Laluan Utama diperlukan",
        "PTY request error: {}" => "Ralat permintaan PTY: {}",
        "Path not allowed: {}" => "Laluan tidak dibenarkan: {}",
        "RDCleanPath request without an X.224 packet" => "Permintaan RDCleanPath tanpa paket X.224",
        "RDP proxy accept error: {}" => "Ralat penerimaan proksi RDP: {}",
        "RDP proxy socket configuration error: {}" => "Ralat konfigurasi soket proksi RDP: {}",
        "RDP server {} does not respond (timeout {} s). Check the address, port and firewall." => "Pelayan RDP {} tidak memberi respons (tamat masa {} s). Semak alamat, port dan tembok api.",
        "RDP session active in the tab" => "Sesi RDP aktif dalam tab",
        "RDP session not found" => "Sesi RDP tidak dijumpai",
        "Remote tunnel (-R): \u001b[36mserver:{}\u001b[0m → \u001b[36m{}:{}\u001b[0m (this computer)" => "Terowong jauh (-R): \u001b[36mpelayan:{}\u001b[0m → \u001b[36m{}:{}\u001b[0m (komputer ini)",
        "SFTP file upload task error: {}" => "Ralat tugas muat naik fail SFTP: {}",
        "SFTP folder upload task error: {}" => "Ralat tugas muat naik folder SFTP: {}",
        "SFTP task error: {}" => "Ralat tugas SFTP: {}",
        "SOCKS5 server (-D): \u001b[36m127.0.0.1:{}\u001b[0m" => "Pelayan SOCKS5 (-D): \u001b[36m127.0.0.1:{}\u001b[0m",
        "SSH channel error: {}" => "Ralat saluran SSH: {}",
        "SSH handshake error: {}" => "Ralat jabat tangan SSH: {}",
        "SSH library initialisation error: {}" => "Ralat permulaan pustaka SSH: {}",
        "SSH private key is missing" => "Kunci peribadi SSH tiada",
        "Salt decoding error: {}" => "Ralat penyahkodan garam (salt): {}",
        "Select at least one group or ungrouped connections" => "Pilih sekurang-kurangnya satu kumpulan atau sambungan tanpa kumpulan",
        "Server {}:{} is not trusted yet and the vault is locked. Unlock the vault and connect again." => "Pelayan {}:{} belum dipercayai dan peti besi terkunci. Buka kunci peti besi dan sambung sekali lagi.",
        "Session closed by the server" => "Sesi ditutup oleh pelayan",
        "Skipped {}: the target folder contains a symbolic link with this name" => "Dilangkau {}: folder sasaran mengandungi pautan simbolik dengan nama ini",
        "System TLS configuration error: {}" => "Ralat konfigurasi TLS sistem: {}",
        "TLS configuration error: {}" => "Ralat konfigurasi TLS: {}",
        "TPKT body read error: {}" => "Ralat membaca badan TPKT: {}",
        "TPKT header read error: {}" => "Ralat membaca pengepala TPKT: {}",
        "The PIN must have {}-{} digits" => "PIN mestilah mempunyai {}-{} angka",
        "The RDP connection changed – check the certificate again" => "Sambungan RDP berubah – semak sijil sekali lagi",
        "The RDP server did not answer the X.224 request" => "Pelayan RDP tidak menjawab permintaan X.224",
        "The RDP server did not present a TLS certificate" => "Pelayan RDP tidak mengemukakan sijil TLS",
        "The SSH connection was closed by the remote server or the network connection was lost." => "Sambungan SSH telah ditutup oleh pelayan jauh atau sambungan rangkaian terputus.",
        "The SSH server did not present a host key" => "Pelayan SSH tidak mengemukakan kunci hos",
        "The backup file is corrupted: {}" => "Fail sandaran rosak: {}",
        "The backup folder must be an absolute path" => "Folder sandaran mestilah laluan mutlak",
        "The backup interval must be between 1 and {} hours" => "Selang masa sandaran mestilah antara 1 hingga {} jam",
        "The certificate or server address changed. Check the fingerprint again." => "Sijil atau alamat pelayan telah berubah. Semak cap jari sekali lagi.",
        "The credential store is locked" => "Simpanan kelayakan terkunci",
        "The current Master Password is incorrect" => "Kata Laluan Utama semasa tidak betul",
        "The decrypted content is not valid UTF-8: {}" => "Kandungan yang dinyahsulit bukan UTF-8 yang sah: {}",
        "The export password" => "Kata laluan eksport",
        "The file '{}' changed since it was opened (another program or person saved it in the meantime)." => "Fail '{}' telah berubah sejak ia dibuka (atur cara atau orang lain telah menyimpannya).",
        "The file clipboard is available only on Windows" => "Papan keratan fail hanya tersedia pada Windows",
        "The file is too large to be saved from the editor." => "Fail terlalu besar untuk disimpan daripada penyunting.",
        "The file name is not valid UTF-8" => "Nama fail bukan UTF-8 yang sah",
        "The import file has no ciphertext" => "Fail import tiada teks sifir",
        "The import file has no nonce" => "Fail import tiada nonce",
        "The import file has no salt" => "Fail import tiada garam (salt)",
        "The import file is encrypted. Enter the password." => "Fail import disulitkan. Masukkan kata laluan.",
        "The key type {} is not supported." => "Jenis kunci {} tidak disokong.",
        "The new version is saved but could not be started: {}" => "Versi baharu telah disimpan tetapi tidak dapat dimulakan: {}",
        "The number of kept backups must be between 1 and {}" => "Bilangan sandaran yang disimpan mestilah antara 1 hingga {}",
        "The pasted text is too large (over 16 MB waiting to be sent) – skipped." => "Teks yang ditampal terlalu besar (melebihi 16 MB menunggu untuk dihantar) – dilangkau.",
        "The private key is protected with a passphrase – enter the key passphrase in the connection settings." => "Kunci peribadi dilindungi dengan frasa laluan – masukkan frasa laluan kunci dalam tetapan sambungan.",
        "The root file system '/' cannot be uploaded." => "Sistem fail akar '/' tidak boleh dimuat naik.",
        "The selected file is not an SSH certificate (expected a …-cert.pub file)" => "Fail yang dipilih bukan sijil SSH (dijangkakan fail …-cert.pub)",
        "The selected file is not an SSH private key" => "Fail yang dipilih bukan kunci peribadi SSH",
        "The server and RemoteFlow have no algorithm in common:" => "Pelayan dan RemoteFlow tiada algoritma yang sepadan:",
        "The server did not respond in time." => "Pelayan tidak memberi respons dalam masa yang ditetapkan.",
        "The server refused to listen on port {} (-R): {}" => "Pelayan enggan mendengar pada port {} (-R): {}",
        "The shell in the terminal belongs to another user (e.g. after sudo/su) – its directory cannot be read." => "Shell dalam terminal milik pengguna lain (cth. selepas sudo/su) – direktorinya tidak dapat dibaca.",
        "The shell of this terminal was not found on the server." => "Shell terminal ini tidak dijumpai pada pelayan.",
        "The target folder does not exist: {}" => "Folder sasaran tidak wujud: {}",
        "The terminal session has ended." => "Sesi terminal telah tamat.",
        "The terminal session is not active." => "Sesi terminal tidak aktif.",
        "The trusted certificate changed in the meantime – check it again" => "Sijil yang dipercayai telah berubah – semak sekali lagi",
        "The vault already exists" => "Peti besi sudah wujud",
        "The vault already exists – reset the current one to create a new one" => "Peti besi sudah wujud – tetapkan semula peti besi semasa untuk mencipta yang baharu",
        "The vault does not exist" => "Peti besi tidak wujud",
        "The vault file changed during the operation – try again" => "Fail peti besi berubah semasa operasi – cuba lagi",
        "The vault file changed while unlocking – try again" => "Fail peti besi berubah semasa membuka kunci – cuba lagi",
        "The vault has not been initialised yet" => "Peti besi belum dimulakan lagi",
        "The vault is locked" => "Peti besi terkunci",
        "The vault is locked – the identity of server {}:{} cannot be checked. Unlock the vault and connect again." => "Peti besi terkunci – identiti pelayan {}:{} tidak dapat disemak. Buka kunci peti besi dan sambung sekali lagi.",
        "The vault must be unlocked to change the PIN settings" => "Peti besi mesti dibuka kuncinya untuk menukar tetapan PIN",
        "The vault must be unlocked to export data" => "Peti besi mesti dibuka kuncinya untuk mengeksport data",
        "The vault must be unlocked to import connections" => "Peti besi mesti dibuka kuncinya untuk mengimport sambungan",
        "The vault must be unlocked to import data" => "Peti besi mesti dibuka kuncinya untuk mengimport data",
        "The whole home folder ({}) cannot be uploaded. Choose a specific subfolder or file." => "Keseluruhan folder rumah ({}) tidak boleh dimuat naik. Pilih subfolder atau fail tertentu.",
        "The whole home folder cannot be uploaded at once. Choose a specific subfolder." => "Keseluruhan folder rumah tidak boleh dimuat naik sekali gus. Pilih subfolder tertentu.",
        "This folder cannot be deleted: {}" => "Folder ini tidak boleh dipadamkan: {}",
        "Too many PIN attempts ({})! The Master Password is required." => "Terlalu banyak percubaan PIN ({})! Kata Laluan Utama diperlukan.",
        "Tunnels reconnected." => "Terowong disambung semula.",
        "Tunnels: could not connect to the server ({}). Will retry with the next connection." => "Terowong: tidak dapat menyambung ke pelayan ({}). Akan mencuba semula pada sambungan seterusnya.",
        "Tunnels: the connection to the server was lost – it will be re-established." => "Terowong: sambungan ke pelayan terputus – ia akan disambung semula.",
        "Unsupported SSH authentication type" => "Jenis pengesahan SSH tidak disokong",
        "Unsupported import file format" => "Format fail import tidak disokong",
        "Unsupported protocol: {}" => "Protokol tidak disokong: {}",
        "Vault file parse error: {}" => "Ralat menghurai fail peti besi: {}",
        "Vault read error: {}" => "Ralat membaca peti besi: {}",
        "Vault serialisation error: {}" => "Ralat pensirilan peti besi: {}",
        "Wrong PIN! Attempts left: {}" => "PIN salah! Baki percubaan: {}",
        "Wrong import file password or corrupted data" => "Kata laluan fail import salah atau data rosak",
        "Wrong private key passphrase." => "Frasa laluan kunci peribadi salah.",
        "X.224 negotiation error with the RDP server: {}" => "Ralat rundingan X.224 dengan pelayan RDP: {}",
        "Yes" => "Ya",
        "cipher (Ciphers)" => "sifir (Ciphers)",
        "copy" => "salinan",
        "host key (HostKeyAlgorithms)" => "kunci hos (HostKeyAlgorithms)",
        "integrity (MACs)" => "integriti (MACs)",
        "key exchange (KexAlgorithms)" => "pertukaran kunci (KexAlgorithms)",
        "the item still exists" => "item masih wujud",
        "this drive has no Recycle Bin" => "pemacu ini tiada Tong Kitar Semula",
        "{} $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Choose a folder'; if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $f.SelectedPath }}" => "{} $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Pilih folder'; if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $f.SelectedPath }}",
        "{} files" => "{} fail",
        "{} must be at least {} characters long" => "{} mestilah sekurang-kurangnya {} aksara",
        "{}: Could not decrypt the mRemoteNG file." => "{}: Tidak dapat menyahsulit fail mRemoteNG.",
        "{}: The mRemoteNG file is protected with its own master password (or the password given is wrong)." => "{}: Fail mRemoteNG dilindungi dengan kata laluan utamanya sendiri (atau kata laluan yang diberikan salah).",
        "ℹ️ The RDP session window was closed (code: {})." => "ℹ️ Tetingkap sesi RDP telah ditutup (kod: {}).",
        "ℹ️ Tip: install the package with:" => "ℹ️ Petua: pasang pakej dengan:",
        "⏹ Closing the RDP process at the user's request..." => "⏹ Menutup proses RDP atas permintaan pengguna...",
        "▶ Starting the RDP connection to {}:{} (user: {})..." => "▶ Memulakan sambungan RDP ke {}:{} (pengguna: {})...",
        "⚠️ Could not prepare the .rdp file ({}), the user name will not be pre-filled." => "⚠️ Tidak dapat menyediakan fail .rdp ({}), nama pengguna tidak akan diisi awal.",
        "⚠️ Could not read the server certificate in advance ({}). FreeRDP will check it itself (TOFU)." => "⚠️ Tidak dapat membaca sijil pelayan terlebih dahulu ({}). FreeRDP akan menyemaknya sendiri (TOFU).",
        "⚠️ Error monitoring the RDP process: {}" => "⚠️ Ralat memantau proses RDP: {}",
        "⚡ Native RDP session window started (PID: {})." => "⚡ Tetingkap sesi RDP asli dimulakan (PID: {}).",
        "✓ RDP client found: {}" => "✓ Klien RDP dijumpai: {}",
        "❌ Error starting the RDP process: {}" => "❌ Ralat memulakan proses RDP: {}",
        "❌ Error: no installed RDP client (FreeRDP) was found." => "❌ Ralat: tiada klien RDP (FreeRDP) yang dipasang dijumpai.",
        "🔐 RDP server certificate remembered (first connection): {}" => "🔐 Sijil pelayan RDP diingati (sambungan pertama): {}",
        _ => en,
    }
}

/// Translates a runtime-formatted English message into Bahasa Melayu by matching its static template.
pub fn ms_translate_formatted(en_template: &'static str, formatted_en: String) -> String {
    let ms_template = ms_lookup(en_template);
    if ms_template == en_template {
        return formatted_en;
    }
    // Split both templates on placeholder tokens ({} / {:?} / {:02x} / {{ / }})
    if let Some(res) = Reconstruct::apply(en_template, ms_template, &formatted_en) {
        return res;
    }
    formatted_en
}

struct Reconstruct;
impl Reconstruct {
    fn split_placeholders(tpl: &str) -> Vec<&str> {
        let mut parts = Vec::new();
        let bytes = tpl.as_bytes();
        let mut i = 0;
        let mut last = 0;
        while i < bytes.len() {
            if bytes[i] == b'{' {
                if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                    i += 2;
                    continue;
                }
                if let Some(end) = tpl[i..].find('}') {
                    parts.push(&tpl[last..i]);
                    i += end + 1;
                    last = i;
                    continue;
                }
            } else if bytes[i] == b'}' && i + 1 < bytes.len() && bytes[i + 1] == b'}' {
                i += 2;
                continue;
            }
            i += 1;
        }
        parts.push(&tpl[last..]);
        parts
    }

    fn apply(en_tpl: &str, ms_tpl: &str, formatted: &str) -> Option<String> {
        let en_parts = Self::split_placeholders(en_tpl);
        let ms_parts = Self::split_placeholders(ms_tpl);
        if en_parts.len() != ms_parts.len() || en_parts.is_empty() {
            return None;
        }
        let prefix = en_parts[0];
        let suffix = *en_parts.last()?;
        if !formatted.starts_with(prefix) || !formatted.ends_with(suffix) || formatted.len() < prefix.len() + suffix.len() {
            return None;
        }
        let mut args = Vec::with_capacity(en_parts.len() - 1);
        let mut rem = &formatted[prefix.len()..formatted.len() - suffix.len()];
        for mid in &en_parts[1..en_parts.len() - 1] {
            let idx = rem.find(mid)?;
            args.push(&rem[..idx]);
            rem = &rem[idx + mid.len()..];
        }
        if en_parts.len() > 1 {
            args.push(rem);
        }
        let mut out = String::with_capacity(formatted.len() + 16);
        out.push_str(&ms_parts[0].replace("{{", "{").replace("}}", "}"));
        for (arg, part) in args.iter().zip(&ms_parts[1..]) {
            out.push_str(arg);
            out.push_str(&part.replace("{{", "{").replace("}}", "}"));
        }
        Some(out)
    }
}

/// `tr!("polski", "english")` → `&'static str`;
/// `tr!("polski {}", "english {}", args…)` → `String` (like `format!`).
#[macro_export]
macro_rules! tr {
    ($pl:literal, $en:literal $(,)?) => {
        if $crate::i18n::is_ms() {
            $crate::i18n::ms_lookup($en)
        } else if $crate::i18n::is_en() {
            $en
        } else {
            $pl
        }
    };
    ($pl:literal, $en:literal, $($arg:tt)+) => {
        if $crate::i18n::is_ms() {
            $crate::i18n::ms_translate_formatted($en, format!($en, $($arg)+))
        } else if $crate::i18n::is_en() {
            format!($en, $($arg)+)
        } else {
            format!($pl, $($arg)+)
        }
    };
}

#[tauri::command]
pub fn app_set_language(lang: String) {
    set_language(&lang);
}

#[cfg(test)]
mod tests {
    #[test]
    fn language_codes() {
        assert!(super::is_english_code("en"));
        assert!(super::is_english_code("EN-gb"));
        assert!(super::is_malay_code("ms"));
        assert!(super::is_malay_code("ms-MY"));
        assert!(!super::is_english_code("pl"));
        assert!(!super::is_malay_code("pl"));
    }

    #[test]
    fn macro_formats_like_format() {
        let expected_pl = "3 plików";
        let expected_en = "3 files";
        let expected_ms = "3 fail";
        let got = tr!("{} plików", "{} files", 3);
        assert!(got == expected_pl || got == expected_en || got == expected_ms);
        assert_eq!(tr!("Tak", "Yes").len(), 3);
    }

    #[test]
    fn malay_backend_lookup_and_formatting() {
        assert_eq!(super::ms_lookup("The vault is locked"), "Peti besi terkunci");
        let formatted = super::ms_translate_formatted(
            "Login failed for user '{}' on server {}. Check the password or key.",
            "Login failed for user 'root' on server 10.0.0.1. Check the password or key.".to_string(),
        );
        assert_eq!(
            formatted,
            "Log masuk gagal untuk pengguna 'root' pada pelayan 10.0.0.1. Semak kata laluan atau kunci."
        );
    }
}
