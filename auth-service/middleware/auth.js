import jwt from 'jsonwebtoken';

const requireAuth = (req, res, next) => {
    try {
        const auth = req.headers.authorization;

    
        if (!auth || !auth.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Missing auth token" });
        }

        const token = auth.split(" ")[1];

        const payload = jwt.verify(token, process.env.JWT_SECRET);

        req.user = payload;
        return next();

    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
};

export default requireAuth;
