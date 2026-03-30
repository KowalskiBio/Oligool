import tempfile
import subprocess
import os
from typing import List, Dict

def run_msa(sequences: List[Dict[str, str]]) -> str:
    """
    Run MAFFT alignment on a list of sequences.
    
    Args:
        sequences: List of dicts with 'id' and 'seq' keys.
        
    Returns:
        The aligned sequences in FASTA format.
    """
    if not sequences:
        return ""

    # Create temporary FASTA file
    with tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.fasta') as temp_in:
        for seq in sequences:
            # Clean sequence
            clean_seq = seq['seq'].strip().replace(" ", "").upper()
            temp_in.write(f">{seq['id']}\n{clean_seq}\n")
        input_file = temp_in.name
    
    try:
        # Resolve MAFFT executable path
        import shutil
        import sys
        
        # Determine base path for bundled dependencies
        # Determine base path for bundled dependencies
        is_frozen_app = getattr(sys, 'frozen', False) and sys.platform == 'darwin' and '.app/Contents/MacOS' in sys.executable
        if is_frozen_app:
            # PyInstaller renames '.bin' to '__dot__bin' inside Contents/Frameworks for valid bundle structure
            base_path = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..', 'Frameworks'))
        elif getattr(sys, 'frozen', False):
            base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        else:
            base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            
        mafft_exe = shutil.which('mafft')
        
        if getattr(sys, 'frozen', False) or not mafft_exe:
            if sys.platform == 'win32':
                local_mafft = os.path.join(base_path, '.bin', 'mafft', 'mafft-win', 'mafft.bat')
            elif is_frozen_app:
                local_mafft = os.path.join(base_path, '__dot__bin', 'mafft', 'mafft-mac', 'mafft-mac', 'mafftdir', 'bin', 'mafft')
            else:
                local_mafft = os.path.join(base_path, '.bin', 'mafft', 'mafft-mac', 'mafft-mac', 'mafftdir', 'bin', 'mafft')
                
            if os.path.exists(local_mafft):
                mafft_exe = local_mafft
                
        if not mafft_exe or not os.path.exists(mafft_exe):
            raise RuntimeError(f"MAFFT executable not found. Expected at {mafft_exe} or in PATH.")
            
        # Prepare environment with specific OS-approved TMPDIR to avoid macOS Sandbox permission issues
        # Using the standard OS temp dir instead of a local project folder bypasses "Operation not permitted"
        base_tmp = tempfile.gettempdir()
        
        # Create a guaranteed unique, pre-existing directory for this specific run
        # This bypasses MAFFT's failing `mktemp` bash calls entirely.
        safe_run_dir = tempfile.mkdtemp(dir=base_tmp)
        
        # We start with a relatively clean environment to avoid user shell pollution
        # which often breaks Homebrew's MAFFT wrapper script.
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
            "TMPDIR": safe_run_dir,
            "MAFFT_TMPDIR": safe_run_dir # Force MAFFT to use our safe directory
        }
        
        if mafft_exe and ('.bin' in mafft_exe or '__dot__bin' in mafft_exe):
            # Set MAFFT_BINARIES so the local wrapper script can find its support binaries
            libexec_dir = os.path.join(os.path.dirname(os.path.dirname(mafft_exe)), 'libexec', 'mafft', 'bin')
            if not os.path.exists(libexec_dir):
                # macOS MAFFT binary ZIP often puts binaries directly in libexec/
                libexec_dir = os.path.join(os.path.dirname(os.path.dirname(mafft_exe)), 'libexec')
                
            if os.path.exists(libexec_dir):
                env["MAFFT_BINARIES"] = libexec_dir
                env["PATH"] = libexec_dir + os.pathsep + os.path.dirname(mafft_exe) + os.pathsep + env["PATH"]

        try:
            # If we have a massive number of sequences (>100), '--auto' becomes O(N^2)
            # which can take several minutes on weak VMs and trigger Cloudflare 100s timeouts.
            # Using '--parttree' provides O(N log N) speed which finishes in seconds.
            if len(sequences) > 100:
                cmd = [mafft_exe, '--parttree', '--retree', '1', '--quiet', input_file]
            else:
                cmd = [mafft_exe, '--auto', '--quiet', input_file]
            
            # Prevent CMD window from flashing on Windows
            creationflags = 0
            if sys.platform == 'win32':
                creationflags = subprocess.CREATE_NO_WINDOW
                
            result = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env, creationflags=creationflags)
            return result.stdout
        finally:
            import shutil
            shutil.rmtree(safe_run_dir, ignore_errors=True)
        
    except subprocess.CalledProcessError as e:
        # If MAFFT fails, raise error with details
        if e.returncode == -9:
            raise RuntimeError(f"MAFFT alignment failed (Process Killed). This usually means the Raspberry Pi ran out of memory (RAM) while processing a large number of sequences or very long sequences.")
        else:
            raise RuntimeError(f"MAFFT alignment failed (Exit {e.returncode}): {e.stderr}")
    except FileNotFoundError:
        # Fallback if shutil.which somehow missed it but subprocess still caught it
        raise RuntimeError("MAFFT executable not found. Please ensure it is installed and in your PATH.")
    finally:
        # Clean up temp file
        if os.path.exists(input_file):
            os.remove(input_file)
            
    return ""
