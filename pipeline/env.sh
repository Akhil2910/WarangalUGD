# Source this in Git Bash to use the GDAL/Python toolchain: . pipeline/env.sh
E=/c/Users/jaipa/miniforge3/envs/wgl
export PATH="$E:$E/Library/bin:$E/Scripts:$PATH"
export GDAL_DATA="$(cygpath -w $E/Library/share/gdal)"
export PROJ_DATA="$(cygpath -w $E/Library/share/proj)"
export GDAL_DRIVER_PATH="$(cygpath -w $E/Library/lib/gdalplugins)"
