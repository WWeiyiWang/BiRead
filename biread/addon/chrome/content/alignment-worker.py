"""BiRead offline alignment worker. One JSON request via stdin, no network."""
import json
import os
import pathlib
import sys

def main():
    config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    sys.path.insert(0, config["deps"])
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    request = json.loads(sys.stdin.buffer.read(262144).decode("utf-8"))
    texts = [request["source"], request["translation"]]
    if any(not isinstance(t, str) or not t or len(t) > 16000 for t in texts):
        raise ValueError("Invalid paragraph length")
    tokenizer = Tokenizer.from_file(str(pathlib.Path(config["model"]) / "tokenizer.json"))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(pathlib.Path(config["model"]) / "model.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    vectors, offsets = [], []
    for text in texts:
        encoded = tokenizer.encode(text)
        if len(encoded.ids) > 512:
            raise ValueError("Paragraph exceeds model's 512-token limit; use manual binding")
        values = {"input_ids": encoded.ids, "attention_mask": encoded.attention_mask, "token_type_ids": encoded.type_ids}
        result = session.run(None, {i.name: np.array([values[i.name]], dtype=np.int64) for i in session.get_inputs()})[0][0]
        keep = [i for i, (a,b) in enumerate(encoded.offsets) if b > a and not encoded.special_tokens_mask[i]]
        v = result[keep]
        vectors.append(v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12))
        # Gecko/DOM ranges use UTF-16 offsets, tokenizer offsets use code points.
        utf16 = [0]
        for c in text:
            utf16.append(utf16[-1] + len(c.encode("utf-16-le")) // 2)
        offsets.append([[utf16[encoded.offsets[i][0]], utf16[encoded.offsets[i][1]]] for i in keep])
    similarity = vectors[0] @ vectors[1].T
    forward, backward = similarity.argmax(axis=1), similarity.argmax(axis=0)
    links = [[offsets[0][i], offsets[1][int(j)]] for i,j in enumerate(forward) if backward[j] == i]
    print(json.dumps({"version": 1, "links": links}, ensure_ascii=True))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True))
        sys.exit(1)
