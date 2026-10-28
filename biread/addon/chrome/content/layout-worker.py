"""BiRead local-only layout worker. JSON stdin/stdout; no translation/network calls."""
import sys, json
from pathlib import Path
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

def main():
    request=json.load(sys.stdin)
    model_path=Path(request['model'])
    if not model_path.is_file(): raise ValueError('Layout model not installed')
    import pymupdf
    import numpy as np
    import cv2
    from babeldoc.docvision.doclayout import OnnxModel
    model=OnnxModel(str(model_path))
    document=pymupdf.open(request['input'])
    pages=[]
    for page in document:
        page.set_rotation(0)
        pix=page.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5),alpha=False)
        image=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width,3)
        result=model.predict(cv2.cvtColor(image,cv2.COLOR_RGB2BGR))[0]
        inverse=~page.transformation_matrix
        regions=[]
        for b in result.boxes:
            r=pymupdf.Rect(*[float(v)/1.5 for v in b.xyxy])*inverse
            regions.append({'label':result.names[int(b.cls)],'confidence':float(b.conf),'rect':list(r)})
        pages.append(regions)
    json.dump({'version':1,'pages':pages},sys.stdout)

if __name__=='__main__':
    try: main()
    except Exception:
        # Do not echo file contents, paths, or upstream errors into the UI.
        json.dump({'version':1,'error':'Local layout analysis failed'},sys.stdout)
        sys.exit(1)
